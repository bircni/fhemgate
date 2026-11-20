// one fhem a platform publishes the devices of
import type { Logging } from 'homebridge';
import { FhemAccessory } from './accessory/accessory.ts';
import { baseUrl, isSwitchedOff, loadJsFunctions, optionalSwitch, type ConnectionConfig } from './config.ts';
import { IdentityStore } from './devices/identityStore.ts';
import type { Jsonlist2Device } from './devices/types.ts';
import { describeError, execute, fetchDevices, type FhemConnection } from './fhem/client.ts';
import { startLongpoll } from './fhem/eventStream.ts';
import { retryDelayAfterError } from './fhem/protocol.ts';
import type { Plugin } from './platform.ts';
import { version } from './settings.ts';

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
      neverTimeout: config.neverTimeout,
      rejectUnauthorized: optionalSwitch(config.rejectUnauthorized),
    };
  }

  /** opens the long poll to fhem, which is kept open for as long as homebridge runs */
  start(): void {
    if (this.connection) {
      startLongpoll(this.#plugin.state, this.connection, () => {
        this.checkAndSetGenericDeviceType();
      });
    }
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
   * The accessories for the devices of the filter, sorted by name.
   *
   * Waits for the long poll to have reached fhem first. When fhem then does not list the
   * devices it is asked again, after a pause that grows like the one of the long poll. No
   * empty list is answered instead: HomeKit would take every accessory for removed and forget
   * its room and its automations.
   */
  accessories(callback: (accessories: FhemAccessory[]) => void): void {
    this.#fetchAccessories(callback, 0);
  }

  /** @param failures how often fhem did not list the devices so far */
  #fetchAccessories(callback: (accessories: FhemAccessory[]) => void, failures: number): void {
    const state = this.#plugin.state;

    const connection = this.connection;
    if (!connection) {
      callback([]);
      return;
    }

    if (state.csrfToken[connection.base_url] === undefined) {
      if (connection.dead) {
        callback([]);
        return;
      }

      let timeout = 500;
      const disconnects = state.longpoll[connection.base_url]?.disconnects;
      if (disconnects) {
        timeout = disconnects * 1000;
      }
      this.log.debug('FHEM csrfToken missing, retry in: ' + timeout + 'msec');
      setTimeout(() => {
        this.#fetchAccessories(callback, failures);
      }, timeout);
      return;
    }

    this.log.info('Fetching FHEM devices...');

    fetchDevices(state, this.log, connection, this.filter, (err, response, json) => {
      if (!err && response?.statusCode === 200 && json) {
        const foundAccessories: FhemAccessory[] = [];
        this.log.info('got: ' + json.totalResultsReturned + ' results');
        if (json.totalResultsReturned) {
          // an entry that is no device, which no fhem should send, sorts first and is reported below
          const results = json.Results.map((s) => s as Jsonlist2Device | null).sort((a, b) => {
            const x = a?.Name ?? '';
            const y = b?.Name ?? '';
            return x < y ? -1 : x > y ? 1 : 0;
          });
          for (const s of results) {
            const accessory = this.#accessoryFor(s);
            if (accessory) {
              foundAccessories.push(accessory);
            }
          }
        }

        this.identities.save(this.log);
        callback(foundAccessories);
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
        setTimeout(() => {
          this.#fetchAccessories(callback, attempt);
        }, pause);
      }
    });
  }

  /**
   * The accessory for a device fhem listed, with its services built. Undefined for a device
   * that is not to be published, and for one the plugin fails on: an error that gets out of here
   * ends homebridge, and with it every accessory of every plugin.
   */
  #accessoryFor(s: Jsonlist2Device | null): FhemAccessory | undefined {
    const state = this.#plugin.state;

    let accessory: FhemAccessory;
    try {
      accessory = new FhemAccessory(this, s as Jsonlist2Device, state, (log, target, cmd, answer) => {
        execute(state, log, target as FhemConnection, cmd, answer);
      });
    } catch (error) {
      this.log.error('no accessory created for ' + (s?.Name ?? 'a device without a name') + ': ' + String(error));
      return undefined;
    }

    if (accessory.skipped !== undefined) {
      this.log.info('no accessory created for ' + s?.Internals.NAME + ' (' + s?.Internals.TYPE + ')');
      return undefined;
    }

    accessory.fhem = this;

    if (!accessory.isInScope('siri')) {
      this.log.info('ignoring ' + accessory.name + ' for siri');
      return undefined;
    }

    // the services are built here and not when homebridge asks for them, where an error could not be caught
    try {
      accessory.prepareServices();
    } catch (error) {
      this.log.error('no accessory created for ' + s?.Name + ': ' + String(error));
      accessory.unsubscribe();
      return undefined;
    }

    return accessory;
  }
}
