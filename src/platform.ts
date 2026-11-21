import type { Server } from 'node:http';
import type { AccessoryPlugin, API, Logging, StaticPlatformPlugin } from 'homebridge';
import type { FhemAccessory } from './accessory/accessory.ts';
import { connectionConfigs, DEFAULT_PORT, type ConnectionConfig, type FhemPlatformConfig } from './config.ts';
import { DEFAULT_DEBUG_PORT, FALLBACK_DEBUG_PORT, debugPortOf, handleDebugRequest, startDebugServer } from './debug/server.ts';
import type { IdentityStore } from './devices/identityStore.ts';
import { connectionFindings, platformFindings } from './migration.ts';
import { FhemServer } from './server.ts';
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

/**
 * The devices of one or more fhem. homebridge creates a platform for every FHEM entry in its
 * config.json and asks it once for its accessories. The platform keeps the long poll to each
 * fhem open for as long as homebridge runs.
 */
export class FhemPlatform implements StaticPlatformPlugin {
  readonly log: Logging;
  readonly config: FhemPlatformConfig;
  readonly api: API;

  /** the fhem the devices come from, in the order of the configuration */
  readonly servers: FhemServer[];

  readonly #plugin: Plugin;

  constructor(log: Logging, config: FhemPlatformConfig, api: API, plugin: Plugin) {
    this.#plugin = plugin;

    this.log = log;
    this.config = config;
    this.api = api;

    this.api.on('shutdown', this.shutdown.bind(this));

    const connections = connectionConfigs(config);
    for (const finding of platformFindings(config.platform)) {
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
    for (const server of this.servers) {
      server.start();
    }
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

  /**
   * Hands homebridge the accessories of every fhem, each sorted by name. A device that two fhem
   * list is published by the one that comes first in the configuration.
   */
  accessories(callback: (foundAccessories: AccessoryPlugin[]) => void): void {
    void (async () => {
      const found: FhemAccessory[] = [];
      for (const server of this.servers) {
        // one after the other: a device two fhem list goes to the one that is asked first
        // eslint-disable-next-line no-await-in-loop
        found.push(...(await new Promise<FhemAccessory[]>((resolve) => server.accessories(resolve))));
      }
      this.#warnAboutTooMany(found.length);
      callback(found as unknown as AccessoryPlugin[]);
    })();
  }

  #warnAboutTooMany(count: number): void {
    if (count <= MAX_BRIDGED_ACCESSORIES) {
      return;
    }

    const filter = this.servers[0]?.filter;
    let subject = 'fhem lists ';
    if (this.servers.length > 1) {
      subject = 'the connections select ';
    } else if (filter) {
      subject = 'the filter ' + filter + ' selects ';
    }
    this.log.warn(
      subject +
        count +
        ' devices that are published. a HomeKit bridge takes ' +
        MAX_BRIDGED_ACCESSORIES +
        ' accessories at most, and HomeKit refuses a bridge with more. ' +
        'narrow the filter, or split the devices over several FHEM platforms with different filters and run each as a child bridge.',
    );
  }
}
