// one fhem a platform publishes the devices of
import type { Logging } from 'homebridge';
import { FhemAccessory, type Skipped } from './accessory/accessory.ts';
import { baseUrl, isSwitchedOff, loadJsFunctions, optionalSwitch, type ConnectionConfig } from './config.ts';
import { IdentityStore } from './devices/identityStore.ts';
import type { Jsonlist2Device } from './devices/types.ts';
import { describeError, execute, fetchDevices, type FhemConnection } from './fhem/client.ts';
import { startLongpoll } from './fhem/eventStream.ts';
import type { DevicesRequest } from './fhem/fetchNow.ts';
import { retryDelayAfterError } from './fhem/protocol.ts';
import type { Plugin } from './platform.ts';
import { version } from './settings.ts';
import type { PluginState } from './state/pluginState.ts';

/** what became of a device fhem listed: an accessory, or why not */
export type Outcome = 'published' | Skipped | 'outOfScope' | 'failed';

/** the devices fhem listed, and the accessories made of them */
export interface Listing {
  accessories: FhemAccessory[];
  /** what became of each device, by its name in fhem */
  devices: Map<string, Outcome>;
}

// the fhem that looks at the attributes of each FHEMWEB, by its url
const checkers = new WeakMap<PluginState, Map<string, FhemServer>>();

/** whether the fhem is the one that looks at the attributes of the FHEMWEB, which the first to ask is */
function checkedBy(state: PluginState, url: string, server: FhemServer): boolean {
  let byUrl = checkers.get(state);
  if (byUrl === undefined) {
    byUrl = new Map();
    checkers.set(state, byUrl);
  }
  if (!byUrl.has(url)) {
    byUrl.set(url, server);
  }
  return byUrl.get(url) === server;
}

/**
 * One fhem: the connection to its FHEMWEB, the long poll that keeps the readings current, and
 * the devices its filter selects. The accessories of a fhem refer to it for what they need of
 * the configuration.
 */
export class FhemServer {
  readonly log: Logging;

  /** the devspec that selects the devices to publish */
  readonly filter: string | undefined;
  /** the functions of the jsFunctions file, or its name while it is not loaded */
  jsFunctions?: unknown;
  readonly scope: unknown;
  /** false if mappings must not carry JavaScript */
  readonly allowInlineFunctions: boolean;

  /** not there for a fhem without a server */
  declare connection?: FhemConnection;
  /** the name of the siri device in fhem, once it was found */
  declare siri_device?: string;

  readonly #plugin: Plugin;
  /** the accessories of the last listing */
  #published: FhemAccessory[] = [];
  /** set while fhem is asked for its devices */
  #listing = false;
  /** the wait before fhem is asked again for its devices, after it did not list them */
  #retry?: ReturnType<typeof setTimeout>;

  /** what each device was first published as, kept in the storage directory of homebridge */
  get identities(): IdentityStore {
    return (this.#plugin.identities ??= new IdentityStore(this.#plugin.storagePath()));
  }

  constructor(log: Logging, config: ConnectionConfig, plugin: Plugin) {
    this.#plugin = plugin;
    this.log = log;

    this.filter = config.filter;
    this.jsFunctions = config.jsFunctions;
    this.scope = config.scope;
    this.allowInlineFunctions = !isSwitchedOff(config.allowInlineFunctions);

    if (config.server === undefined) {
      log.error('incomplete configuration ');
      return;
    }

    if (config.jsFunctions !== undefined) {
      const functions = loadJsFunctions(config.jsFunctions, plugin.storagePath(), log);
      if (functions === undefined) {
        delete this.jsFunctions;
      } else {
        this.jsFunctions = functions;
      }
    }

    this.connection = {
      base_url: baseUrl(config, log),
      auth: config.auth,
      log: log,
      rejectUnauthorized: optionalSwitch(config.rejectUnauthorized),
    };
  }

  /**
   * Opens the long poll to fhem, which is kept open for as long as homebridge runs.
   *
   * @param onConnected called every time FHEMWEB has answered the long poll
   */
  start(onConnected?: () => void): void {
    const connection = this.connection;
    if (connection) {
      startLongpoll(this.#plugin.state, connection, () => {
        // two connections to one fhem share its long poll, and fhem is looked at once for both
        if (checkedBy(this.#plugin.state, connection.base_url, this)) {
          this.checkAndSetGenericDeviceType();
        }
        onConnected?.();
      });
    }
  }

  /** how fetchDevicesNow asks this fhem for its devices. none for a fhem without a server. */
  request(): DevicesRequest | undefined {
    return (
      this.connection && {
        base_url: this.connection.base_url,
        auth: this.connection.auth,
        rejectUnauthorized: this.connection.rejectUnauthorized,
        filter: this.filter,
      }
    );
  }

  /** whether FHEMWEB answers the long poll */
  get reachable(): boolean {
    return this.connection !== undefined && this.#plugin.state.longpoll[this.connection.base_url]?.reachable === true;
  }

  /** runs a command in fhem. see execute in fhem/client.ts. */
  execute(cmd: string, callback?: (result: string) => void): void {
    execute(this.#plugin.state, this.log, this.connection as FhemConnection, cmd, callback);
  }

  /**
   * Makes sure fhem knows the homebridgeMapping and genericDeviceType attributes, and looks for
   * the siri device until it is found. Called every time the long poll was opened.
   */
  checkAndSetGenericDeviceType(): void {
    this.log('Checking devices and attributes...');

    this.execute('{AttrVal("global","userattr","")}', (result) => {
      if (!result.match(/(^| )homebridgeMapping\b/)) {
        this.execute('{ addToAttrList( "homebridgeMapping:textField-long" ) }');
        this.log.info('homebridgeMapping attribute created.');
      }

      if (!result.match(/(^| )genericDeviceType\b/)) {
        const cmd = '{addToAttrList( "genericDeviceType:security,ignore,switch,outlet,light,blind,thermometer,thermostat,contact,garage,window,lock" ) }';
        this.execute(cmd, () => {
          // the devices were or are listed without it. homebridge goes on with what it has.
          this.log.error('genericDeviceType attribute was not known to fhem and was created. restart homebridge after giving it to devices.');
        });
      }
    });

    if (this.siri_device !== undefined) {
      return;
    }

    this.execute('jsonlist2 TYPE=siri', (result) => {
      try {
        const d = JSON.parse(result) as { totalResultsReturned: number; Results: { Name: string }[] };
        if (d.totalResultsReturned === 1) {
          this.siri_device = (d.Results[0] as { Name: string }).Name;
          this.log.info('siri device is ' + this.siri_device);
          // the name of this internal is what the siri module of fhem looks for
          this.execute('{$defs{' + this.siri_device + '}->{"homebridge-fhem version"} = "' + version + '"}');
        } else {
          this.log.warn('no siri device found. please define it.');
        }
      } catch {
        this.log.error('failed to parse ' + result);
      }
    });
  }

  /**
   * Asks fhem for the devices of the filter and builds the accessories for them, sorted by name.
   * The accessories of the listing before are given up.
   *
   * When fhem does not list the devices it is asked again, after a pause that grows like the
   * one of the long poll. No empty list is answered instead. A call while fhem is asked already
   * is left to the one under way, and one while it waits to ask again asks at once.
   */
  list(callback: (listing: Listing) => void): void {
    if (this.#retry !== undefined) {
      clearTimeout(this.#retry);
      this.#retry = undefined;
      this.#listing = false;
    }
    if (this.#listing) {
      return;
    }
    this.#listing = true;
    this.#fetch((devices) => {
      this.#listing = false;
      callback(this.build(devices));
    }, 0);
  }

  /** gives up an accessory of the last listing that the platform does not publish */
  reject(accessory: FhemAccessory): void {
    accessory.unsubscribe();
    this.#published = this.#published.filter((each) => each !== accessory);
  }

  /** the accessories for devices fhem listed. the accessories of the listing before are given up. */
  build(devices: (Jsonlist2Device | null)[]): Listing {
    for (const accessory of this.#published) {
      accessory.unsubscribe();
    }

    const listing: Listing = { accessories: [], devices: new Map() };
    // an entry that is no device, which no fhem should send, sorts first and is reported below
    const sorted = [...devices].sort((a, b) => {
      const x = a?.Name ?? '';
      const y = b?.Name ?? '';
      return x < y ? -1 : x > y ? 1 : 0;
    });
    for (const s of sorted) {
      const { accessory, outcome } = this.#accessoryFor(s);
      // what fhem should not send, a device without internals, is reported by #accessoryFor
      const name = (s as { Internals?: { NAME?: string } } | null)?.Internals?.NAME;
      if (name !== undefined) {
        listing.devices.set(name, outcome);
      }
      if (accessory) {
        listing.accessories.push(accessory);
      }
    }

    this.#published = listing.accessories;
    this.identities.save(this.log);
    return listing;
  }

  /** @param failures how often fhem did not list the devices so far */
  #fetch(callback: (devices: (Jsonlist2Device | null)[]) => void, failures: number): void {
    const state = this.#plugin.state;

    const connection = this.connection;
    if (!connection) {
      callback([]);
      return;
    }

    this.log.info('Fetching FHEM devices...');

    fetchDevices(state, this.log, connection, this.filter, (err, response, json) => {
      if (!err && response?.statusCode === 200 && json) {
        this.log.info('got: ' + json.totalResultsReturned + ' results');
        callback(json.totalResultsReturned ? json.Results : []);
      } else {
        this.log.error('There was a problem connecting to FHEM');
        if (err) {
          this.log.error('  ' + describeError(err));
        } else if (response?.statusCode !== 200) {
          this.log.error('  ' + response?.statusCode + ': ' + response?.statusMessage);
        } else {
          this.log.error('  the answer is no list of devices');
        }

        const attempt = failures + 1;
        const pause = retryDelayAfterError(attempt);
        this.log.error('fetching the devices failed for the ' + attempt + '. time, trying again in: ' + pause + 'msec');
        this.#retry = setTimeout(() => {
          this.#retry = undefined;
          this.#fetch(callback, attempt);
        }, pause);
      }
    });
  }

  /**
   * The accessory for a device fhem listed, with its services built, or what kept it from being
   * one. A device the plugin fails on is no accessory: an error that gets out of here ends
   * homebridge, and with it every accessory of every plugin.
   */
  #accessoryFor(s: Jsonlist2Device | null): { accessory?: FhemAccessory; outcome: Outcome } {
    const state = this.#plugin.state;

    let accessory: FhemAccessory;
    try {
      accessory = new FhemAccessory(this, s as Jsonlist2Device, state, (log, target, cmd, answer) => {
        execute(state, log, target as FhemConnection, cmd, answer);
      });
    } catch (error) {
      this.log.error('no accessory created for ' + (s?.Name ?? 'a device without a name') + ': ' + String(error));
      return { outcome: 'failed' };
    }

    if (accessory.skipped !== undefined) {
      this.log.info('no accessory created for ' + s?.Internals.NAME + ' (' + s?.Internals.TYPE + ')');
      return { outcome: accessory.skipped };
    }

    accessory.fhem = this;

    if (!accessory.isInScope('siri')) {
      this.log.info('ignoring ' + accessory.name + ' for siri');
      accessory.unsubscribe();
      return { outcome: 'outOfScope' };
    }

    // the services are built here and not when homebridge asks for them, where an error could not be caught
    try {
      accessory.prepareServices();
    } catch (error) {
      this.log.error('no accessory created for ' + s?.Name + ': ' + String(error));
      accessory.unsubscribe();
      return { outcome: 'failed' };
    }

    return { accessory, outcome: 'published' };
  }
}
