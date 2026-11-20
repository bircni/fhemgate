import type { Server } from 'node:http';
import type { API, Categories, DynamicPlatformPlugin, Logging, PlatformAccessory } from 'homebridge';
import { answerNotResponding, applyServices, type AccessoryContext } from './accessory/platformAccessory.ts';
import { connectionConfigs, DEFAULT_PORT, type ConnectionConfig, type FhemPlatformConfig } from './config.ts';
import { DEFAULT_DEBUG_PORT, FALLBACK_DEBUG_PORT, debugPortOf, handleDebugRequest, startDebugServer } from './debug/server.ts';
import { accessoryUuid, uuidPrefixOf } from './devices/identity.ts';
import type { IdentityStore } from './devices/identityStore.ts';
import { fetchDevicesNow } from './fhem/fetchNow.ts';
import { connectionFindings, platformFindings } from './migration.ts';
import { FhemServer, type Listing, type Outcome } from './server.ts';
import { PLATFORM_NAME, PLUGIN_NAME } from './settings.ts';
import type { PluginState } from './state/pluginState.ts';

export { version } from './settings.ts';

/**
 * How many accessories one HomeKit bridge can carry: 150 with the bridge itself. A bridge with
 * more can not be added to HomeKit, and one that grows beyond it stops responding as a whole.
 */
export const MAX_BRIDGED_ACCESSORIES = 149;

/** what all FHEM platforms of a homebridge share */
export interface Plugin {
  state: PluginState;
  /** the directory homebridge keeps its configuration in */
  storagePath(): string;
  /** the debug servers that were started, by the port the configuration asked for */
  debugServers: Map<number, Server>;
  /** what each device was first published as */
  identities?: IdentityStore;
  /** whether a platform was created already. homebridge runs a dynamic platform once per bridge. */
  platformCreated?: boolean;
}

/**
 * How a connection is named in the log: its server and port, and its filter, which tells apart
 * two that talk to one fhem. One without a server by its place in the configuration.
 */
function connectionName(connection: ConnectionConfig, index: number): string {
  if (connection.server === undefined) {
    return 'connection ' + String(index + 1);
  }
  return connection.server + ':' + String(connection.port || DEFAULT_PORT) + (connection.filter ? ' ' + connection.filter : '');
}

/** a logger that starts every line with the prefix, so that the lines of several fhem can be told apart */
function prefixed(log: Logging, prefix: string): Logging {
  const add = (message: unknown): string => '[' + prefix + '] ' + String(message);
  const logger = ((message: string, ...parameters: unknown[]) => {
    log(add(message), ...parameters);
  }) as Logging;
  for (const level of ['info', 'success', 'warn', 'error', 'debug'] as const) {
    logger[level] = (message: string, ...parameters: unknown[]) => {
      log[level](add(message), ...parameters);
    };
  }
  logger.log = (level, message, ...parameters: unknown[]) => {
    log.log(level, add(message), ...parameters);
  };
  logger.prefix = log.prefix;
  return logger;
}

/** sorts the list by the key, in place */
export function sortByKey<T>(array: T[], key: keyof T): T[] {
  return array.sort((a, b) => {
    const x = a[key];
    const y = b[key];
    return x < y ? -1 : x > y ? 1 : 0;
  });
}

/** milliseconds a device has to be gone from what fhem publishes before its accessory is removed */
export const REMOVAL_DELAY = 10 * 60 * 1000;

/** what removes the accessory of a device fhem lists: it is left out on purpose. one the plugin failed on stays, as that may pass. */
const removedFor = new Set<Outcome>(['ignored', 'outOfScope']);

/** whether this homebridge runs a child bridge, which is a process of its own */
function isChildBridge(): boolean {
  return process.argv[1]?.endsWith('childBridgeFork.js') === true;
}

/**
 * The devices of one or more fhem, as a dynamic platform. homebridge keeps the accessories from
 * one start to the next and publishes them before fhem answers. The platform keeps the long poll
 * to each fhem open for as long as homebridge runs, and builds the accessories every time it was
 * opened, from what fhem lists then.
 */
export class FhemPlatform implements DynamicPlatformPlugin {
  readonly log: Logging;
  readonly config: FhemPlatformConfig;
  readonly api: API;

  /** the fhem the devices come from, in the order of the configuration */
  readonly servers: FhemServer[];

  readonly #plugin: Plugin;
  /** the platform name the uuids of the accessories are made with */
  readonly #uuidPrefix: string;
  /** the accessories homebridge has for the platform, by their uuid */
  readonly #cached = new Map<string, PlatformAccessory<AccessoryContext>>();
  /** the uuids of the accessories each fhem published with its last listing. a fhem is here once it listed its devices. */
  readonly #claimed = new Map<FhemServer, Set<string>>();
  /** what homebridge keeps of each accessory, as last handed to it */
  readonly #shapes = new Map<string, string>();
  /** since when the device of an accessory is gone, by the uuid of the accessory */
  readonly #missing = new Map<string, number>();
  /** set while the devices are to be listed again */
  #again?: ReturnType<typeof setTimeout>;

  constructor(log: Logging, config: FhemPlatformConfig, api: API, plugin: Plugin) {
    this.#plugin = plugin;

    this.log = log;
    this.config = config;
    this.api = api;

    this.api.on('shutdown', this.shutdown.bind(this));
    this.api.on('didFinishLaunching', () => {
      this.#launch();
    });

    this.#uuidPrefix = uuidPrefixOf(config.migrateFrom);

    // homebridge 2 refuses a second entry itself. homebridge 1 would hand all accessories it kept
    // to the last one, and the others would publish theirs again.
    const second = plugin.platformCreated === true;
    plugin.platformCreated = true;
    if (second) {
      log.error(
        'there is another fhemgate platform on this bridge. this one publishes nothing: merge them into one entry with connections, see docs/configuration.md.',
      );
    }

    const connections = second ? [] : connectionConfigs(config);
    for (const finding of platformFindings(config)) {
      log[finding.level](finding.text);
    }
    const several = connections.length > 1;
    const logs = connections.map((connection, index) => (several ? prefixed(log, connectionName(connection, index)) : log));
    connections.forEach((connection, index) => {
      for (const finding of connectionFindings(connection)) {
        logs[index]?.[finding.level](finding.text);
      }
    });

    this.#startDebugServer();

    this.servers = connections.map((connection, index) => new FhemServer(logs[index] ?? log, connection, plugin));
  }

  /**
   * Starts the debug server, unless the configuration switches it off or another platform
   * already started one for the port. Without a port in the configuration it is the default
   * port, or the one after it when that is taken.
   */
  #startDebugServer(): void {
    const port = debugPortOf(this.config.debugPort);
    if (port === 'off') {
      return;
    }
    if (port === undefined) {
      this.log.error('config: value for debugPort has to be a port number or false. the debug server is not started.');
      return;
    }

    const host = typeof this.config.debugHost === 'string' && this.config.debugHost !== '' ? this.config.debugHost : undefined;
    const fallbackPort = this.config.debugPort === undefined && port === DEFAULT_DEBUG_PORT ? FALLBACK_DEBUG_PORT : undefined;

    const { state, debugServers } = this.#plugin;
    if (!debugServers.has(port)) {
      const server = startDebugServer(
        { port, host, fallbackPort },
        (request, response) => {
          handleDebugRequest(request, response, state, state.longpoll);
        },
        this.log,
      );
      debugServers.set(port, server);
    }
  }

  /** homebridge is shutting down: the histories are written to disk and the debug servers stop listening */
  shutdown(): void {
    for (const [port, server] of this.#plugin.debugServers) {
      server.close();
      this.#plugin.debugServers.delete(port);
    }

    for (const subscriptions of Object.values(this.#plugin.state.subscriptions.byInformId)) {
      for (const subscription of subscriptions ?? []) {
        const accessory = subscription.accessory;
        if (accessory.shutdown) {
          continue;
        }

        if (accessory.historyService) {
          accessory.historyService.save();
        }

        accessory.shutdown = true;
      }
    }
  }

  /** homebridge restored an accessory it kept from the start before */
  configureAccessory(accessory: PlatformAccessory<AccessoryContext>): void {
    this.#cached.set(accessory.UUID, accessory);
    answerNotResponding(accessory, this.api.hap);
  }

  /**
   * homebridge has restored what it kept. With migrateFrom and nothing restored, the devices are
   * fetched from fhem right away, see #publishBeforeHomebridge. Then the long poll to each fhem
   * is opened, and every time fhem answers it its devices are listed and published.
   *
   * A child bridge is not waited for: it publishes a bridge of its own, which is empty then, and
   * homebridge drops no ids for an empty one.
   */
  #launch(): void {
    const others = [...this.#cached.values()].filter((accessory) => (accessory.context.uuidPrefix ?? this.#uuidPrefix) !== this.#uuidPrefix);
    if (others.length) {
      this.log.warn(
        others.length +
          ' accessories homebridge kept were made with migrateFrom "' +
          String(others[0]?.context.uuidPrefix) +
          '". they are not published again and stay without response: set migrateFrom back, or remove them in the Homebridge UI.',
      );
    }

    if (this.config.migrateFrom !== undefined && this.#cached.size === 0 && !isChildBridge()) {
      this.#publishBeforeHomebridge();
    }

    for (const server of this.servers) {
      server.start(() => {
        this.#list(server);
      });
    }
  }

  /**
   * Fetches the devices and publishes their accessories before homebridge publishes the bridge.
   * HomeKit knows the accessories of homebridge-fhem by ids that homebridge forgets for an
   * accessory that is not on the bridge when it is published. A dynamic platform otherwise
   * publishes its accessories only once fhem answers, which is too late on the first start.
   */
  #publishBeforeHomebridge(): void {
    this.log.info('migrateFrom: fetching the devices from fhem before homebridge publishes the bridge');
    const lists = fetchDevicesNow(
      this.servers.map((server) => server.request()),
      { log: this.log },
    );
    this.servers.forEach((server, index) => {
      const devices = lists[index];
      if (devices !== undefined) {
        this.#publish(server, server.build(devices));
      } else if (server.connection) {
        this.log.error(
          'migrateFrom: fhem could not be asked for its devices before homebridge publishes the bridge. HomeKit takes the accessories of ' +
            server.connection.base_url +
            ' for new ones.',
        );
      }
    });
  }

  /** asks the fhem for its devices and publishes them */
  #list(server: FhemServer): void {
    server.list((listing) => {
      this.#publish(server, listing);
    });
  }

  /**
   * Publishes the accessories of a listing of a fhem: the ones homebridge restored get the
   * services built now, the others are registered. Then the accessories of devices that are
   * gone are looked at, see #removeGone.
   */
  #publish(server: FhemServer, listing: Listing, now = Date.now()): void {
    const index = this.servers.indexOf(server);
    const generate = (data: string): string => this.api.hap.uuid.generate(data);
    const added: PlatformAccessory<AccessoryContext>[] = [];
    const changed: PlatformAccessory<AccessoryContext>[] = [];
    const claimed = new Set<string>();
    let tooMany = 0;

    for (const accessory of listing.accessories) {
      const uuid = accessoryUuid(generate, this.#uuidPrefix, accessory);
      const elsewhere = [...this.#claimed].some(([other, uuids]) => other !== server && uuids.has(uuid));
      if (claimed.has(uuid) || elsewhere) {
        this.log.warn(accessory.name + ' has the identity of an accessory that is published already, and is left out');
        server.reject(accessory);
        continue;
      }

      let target = this.#cached.get(uuid);
      if (target === undefined) {
        if (this.#cached.size + added.length >= MAX_BRIDGED_ACCESSORIES) {
          this.log.error(accessory.name + ' is not published: the bridge has ' + MAX_BRIDGED_ACCESSORIES + ' accessories, which is all a HomeKit bridge takes');
          server.reject(accessory);
          tooMany++;
          continue;
        }
        // the homebridgeMapping attribute names the category, which is looked up in the Categories of HAP-NodeJS
        // eslint-disable-next-line typescript/no-unsafe-enum-assignment, typescript/no-unnecessary-type-assertion
        target = new this.api.platformAccessory<AccessoryContext>(accessory.name as string, uuid, accessory.category as Categories | undefined);
        added.push(target);
      }

      Object.assign(target.context, {
        device: accessory.device,
        fuuid: accessory.fuuid,
        server: index,
        uuidPrefix: this.#uuidPrefix,
      } satisfies AccessoryContext);
      const services = accessory.getServices();
      const information = services.find((service) => service.UUID === this.api.hap.Service.AccessoryInformation.UUID);
      // what HomeKit shows as the name of the accessory, which homebridge set for a static platform
      information?.setCharacteristic(this.api.hap.Characteristic.Name, accessory.siriName ?? accessory.name ?? '');
      // HAP-NodeJS 0.x listens for the request to identify at the information service it built,
      // which the one built here replaces. HAP-NodeJS 2 also runs what the characteristic is given.
      information?.getCharacteristic(this.api.hap.Characteristic.Identify).on('set', (_value, callback) => {
        accessory.identify(callback);
      });
      applyServices(target, services);
      claimed.add(uuid);

      // homebridge writes all it keeps to disk for an update. only what it keeps of the accessory counts.
      const shape = JSON.stringify([target.displayName, target.context, services.map((service) => service.getServiceId())]);
      if (!added.includes(target) && this.#shapes.get(uuid) !== shape) {
        changed.push(target);
      }
      this.#shapes.set(uuid, shape);
    }
    this.#claimed.set(server, claimed);

    if (changed.length) {
      this.#homebridge('update', () => {
        this.api.updatePlatformAccessories(changed);
      });
    }
    if (added.length) {
      this.#register(added);
    }

    this.#removeGone(server, listing, now);
    this.#listAgainLater(now);

    if (tooMany) {
      this.log.warn(
        tooMany +
          ' devices are not published: a HomeKit bridge takes ' +
          MAX_BRIDGED_ACCESSORIES +
          ' accessories at most, and HomeKit refuses a bridge with more. ' +
          'narrow the filter, or split the devices over several fhemgate platforms with different filters and run each as a child bridge.',
      );
    }
  }

  /** the fhem the accessory belongs to: the one it was published from, or any for one of a fhem that is no longer configured */
  #belongsTo(accessory: PlatformAccessory<AccessoryContext>, index: number): boolean {
    const from = accessory.context.server;
    return from === undefined || from === index || this.servers[from]?.connection === undefined;
  }

  /**
   * Removes the accessories of the fhem whose devices are gone: fhem no longer lists them, or
   * they are left out on purpose now. That is only decided once every fhem of the entry has
   * listed its devices, and only for a device that is still gone REMOVAL_DELAY later. A device
   * fhem lists but the plugin could not make an accessory of keeps its accessory, and so does an
   * accessory whose uuid was made with another migrateFrom.
   */
  #removeGone(server: FhemServer, listing: Listing, now: number): void {
    const index = this.servers.indexOf(server);
    const complete = this.servers.every((each) => each.connection === undefined || this.#claimed.has(each));
    const claimed = this.#claimed.get(server);
    const gone: PlatformAccessory<AccessoryContext>[] = [];

    for (const [uuid, accessory] of this.#cached) {
      const otherPrefix = (accessory.context.uuidPrefix ?? this.#uuidPrefix) !== this.#uuidPrefix;
      if (claimed?.has(uuid)) {
        this.#missing.delete(uuid);
        continue;
      }
      if (otherPrefix || !this.#belongsTo(accessory, index)) {
        continue;
      }

      // the accessory built for it before no longer hears from fhem
      answerNotResponding(accessory, this.api.hap);

      const device = accessory.context.device;
      const outcome = device === undefined ? undefined : listing.devices.get(device);
      if (outcome !== undefined && !removedFor.has(outcome)) {
        this.#missing.delete(uuid);
        continue;
      }
      if (!complete) {
        continue;
      }

      const since = this.#missing.get(uuid);
      if (since === undefined) {
        this.#missing.set(uuid, now);
        this.log.info(
          accessory.displayName + ' is no longer published by fhem. its accessory is removed if that is still so in ' + REMOVAL_DELAY / 60_000 + ' minutes.',
        );
      } else if (now - since >= REMOVAL_DELAY) {
        gone.push(accessory);
      }
    }

    for (const accessory of gone) {
      this.log.info('removing ' + accessory.displayName + ', which fhem no longer publishes');
      this.#cached.delete(accessory.UUID);
      this.#missing.delete(accessory.UUID);
      this.#shapes.delete(accessory.UUID);
    }
    if (gone.length) {
      this.#homebridge('unregister', () => {
        this.api.unregisterPlatformAccessories(PLUGIN_NAME, PLATFORM_NAME, gone);
      });
    }
  }

  /** hands homebridge new accessories */
  #register(added: PlatformAccessory<AccessoryContext>[]): void {
    this.#homebridge('register', () => {
      this.api.registerPlatformAccessories(PLUGIN_NAME, PLATFORM_NAME, added);
      for (const accessory of added) {
        this.#cached.set(accessory.UUID, accessory);
      }
    });
  }

  /** lists the devices again when the first accessory whose device is gone is due to be removed, of the fhem it belongs to */
  #listAgainLater(now: number): void {
    if (this.#again !== undefined || this.#missing.size === 0) {
      return;
    }
    const due = Math.min(...this.#missing.values()) + REMOVAL_DELAY;
    this.#again = setTimeout(
      () => {
        this.#again = undefined;
        const missing = [...this.#missing.keys()].flatMap((uuid) => this.#cached.get(uuid) ?? []);
        // a fhem that can not be reached is listed once it is back
        this.servers.forEach((server, index) => {
          if (server.reachable && missing.some((accessory) => this.#belongsTo(accessory, index))) {
            this.#list(server);
          }
        });
      },
      Math.max(due - now, 0) + 1000,
    );
    this.#again.unref();
  }

  /** calls homebridge. what it throws is logged: it would end homebridge with every accessory of every plugin. */
  #homebridge(what: string, call: () => void): void {
    try {
      call();
    } catch (error) {
      this.log.error('homebridge refused to ' + what + ' accessories: ' + String(error));
    }
  }
}
