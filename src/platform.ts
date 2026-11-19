import { createRequire } from 'node:module';
import type { AccessoryPlugin, API, Logging, StaticPlatformPlugin } from 'homebridge';
import { FhemAccessory } from './accessory/accessory.ts';
import { baseUrl, loadJsFunctions, type FhemPlatformConfig } from './config.ts';
import type { Jsonlist2Device } from './devices/types.ts';
import { execute, fetchDevices, type FhemConnection } from './fhem/client.ts';
import { startLongpoll } from './fhem/eventStream.ts';
import type { PluginState } from './state/pluginState.ts';

const require = createRequire(import.meta.url);

/** the version of this plugin */
export const version = (require('../package.json') as { version: string }).version;

/** what all FHEM platforms of a homebridge share */
export interface Plugin {
  state: PluginState;
  /** the directory homebridge keeps its configuration in */
  storagePath(): string;
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
 * One fhem. homebridge creates a platform for every FHEM entry in its config.json and asks it
 * once for its accessories. The platform keeps the long poll to fhem open for as long as
 * homebridge runs.
 */
export class FhemPlatform implements StaticPlatformPlugin {
  readonly log: Logging;
  readonly config: FhemPlatformConfig;
  readonly api: API;

  readonly server: string | undefined;
  readonly port: number | string;
  /** the devspec that selects the devices to publish */
  readonly filter: string | undefined;
  /** the functions of the jsFunctions file, or its name while it is not loaded */
  jsFunctions?: unknown;
  readonly scope: unknown;

  /** not there for a platform without a server */
  declare connection?: FhemConnection;
  /** the name of the siri device in fhem, once it was found */
  declare siri_device?: string;

  readonly #plugin: Plugin;

  constructor(log: Logging, config: FhemPlatformConfig, api: API, plugin: Plugin) {
    this.#plugin = plugin;

    this.log = log;
    this.config = config;
    this.api = api;

    this.api.on('shutdown', this.shutdown.bind(this));

    this.server = config.server;
    this.port = config.port || 8083;
    this.filter = config.filter;
    this.jsFunctions = config.jsFunctions;

    this.scope = config.scope;

    if (this.server === undefined) {
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

    this.connection = { base_url: baseUrl(config, log), auth: config.auth, log: log, neverTimeout: config.neverTimeout };

    startLongpoll(plugin.state, this.connection, () => {
      this.checkAndSetGenericDeviceType();
    });
  }

  /** homebridge is shutting down: the histories are written to disk */
  shutdown(): void {
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

  /** runs a command in fhem. see execute in fhem/client.ts. */
  execute(cmd: string, callback?: (result: string) => void): void {
    execute(this.#plugin.state, this.log, this.connection as FhemConnection, cmd, callback);
  }

  /**
   * Makes sure fhem knows the homebridgeMapping and genericDeviceType attributes, and looks for
   * the siri device until it is found. Called every time the long poll was opened.
   *
   * Ends the homebridge process after it created the genericDeviceType attribute.
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
          this.log.warn('genericDeviceType attribute was not known. please restart.');
          if (this.#plugin.state.csrfToken[(this.connection as FhemConnection).base_url]) {
            process.exit(0);
          }
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
   * Hands homebridge the accessories for the devices of the filter, sorted by name.
   *
   * Waits for the long poll to have reached fhem first. The callback is never called when fhem
   * then refuses to list the devices, which leaves homebridge waiting.
   */
  accessories(callback: (foundAccessories: AccessoryPlugin[]) => void): void {
    const state = this.#plugin.state;
    const foundAccessories: FhemAccessory[] = [];
    const done = (): void => {
      callback(foundAccessories as unknown as AccessoryPlugin[]);
    };

    const connection = this.connection;
    if (!connection) {
      done();
      return;
    }

    if (state.csrfToken[connection.base_url] === undefined) {
      if (connection.dead) {
        done();
        return;
      }

      let timeout = 500;
      const disconnects = state.longpoll[connection.base_url]?.disconnects;
      if (disconnects) {
        timeout = disconnects * 1000;
      }
      this.log.debug('FHEM csrfToken missing, retry in: ' + timeout + 'msec');
      setTimeout(() => {
        this.accessories(callback);
      }, timeout);
      return;
    }

    this.log.info('Fetching FHEM devices...');

    fetchDevices(state, this.log, connection, this.filter, (err, response, json) => {
      if (!err && response?.statusCode === 200 && json) {
        this.log.info('got: ' + json.totalResultsReturned + ' results');
        if (json.totalResultsReturned) {
          for (const s of sortByKey<Jsonlist2Device>(json.Results, 'Name')) {
            const accessory = new FhemAccessory(this, s, state, (log, target, cmd, answer) => {
              execute(state, log, target as FhemConnection, cmd, answer);
            });
            if (accessory.service_name) {
              accessory.fhem = this;

              if (!accessory.isInScope('siri')) {
                this.log.info('ignoring ' + accessory.name + ' for siri');
                continue;
              }

              foundAccessories.push(accessory);
            } else {
              this.log.info('no accessory created for ' + s.Internals.NAME + ' (' + s.Internals.TYPE + ')');
            }
          }
        }

        done();
      } else {
        this.log.error('There was a problem connecting to FHEM');
        if (response) {
          this.log.error('  ' + response.statusCode + ': ' + response.statusMessage);
        }
      }
    });
  }
}
