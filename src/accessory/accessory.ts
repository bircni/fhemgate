import util from 'node:util';
import type { Characteristic, Service } from '@homebridge/hap-nodejs';
import type { Logging } from 'homebridge';
import { detectMappings, reviseMappings } from '../devices/detect.ts';
import { deviceIdentity } from '../devices/identity.ts';
import type { Jsonlist2Device } from '../devices/types.ts';
import { prepareMappings } from '../mapping/compile.ts';
import { parseHomebridgeMapping } from '../mapping/parser.ts';
import { commandFor } from '../mapping/toFhem.ts';
import { reading2homekit } from '../mapping/toHomekit.ts';
import type { CharacteristicClass, HomekitValue, Mapping, Mappings, PreparedMapping } from '../mapping/types.ts';
import type { PluginState } from '../state/pluginState.ts';
import type { MappedCharacteristic } from '../state/subscriptions.ts';
import { looselyEqual } from '../util/loose.ts';
import { CustomUUIDs } from './customCharacteristics.ts';
import type { HistoryService } from './history.ts';
import { createServices } from './services.ts';

/** sends a command to fhem and hands the answer to the callback. the callback is not called when fhem can not be reached. */
export type Execute = (log: Logging, connection: unknown, cmd: string, callback?: (result: string) => void) => void;

/** answers a read of a characteristic: with an error, or with undefined and the value */
export type QueryCallback = (error?: unknown, value?: HomekitValue) => void;

/** what an accessory takes from the platform it belongs to */
export interface AccessoryPlatform {
  log: Logging;
  /** the connection to fhem commands are sent over */
  connection?: unknown;
  /** the functions of the jsFunctions file */
  jsFunctions?: unknown;
}

/** a service with the name it was created under, which the plugin keeps at the service */
export type NamedService = Service & { service_name?: string };

/** the genericDeviceType values and the HomeKit services they stand for */
const serviceNameOfGenericDeviceType: Record<string, string | null | undefined> = {
  ignore: null,
  security: 'SecuritySystem',
  switch: 'Switch',
  outlet: 'Outlet',
  light: 'Lightbulb',
  blind: 'WindowCovering',
  contact: 'ContactSensor',
  thermometer: 'TemperatureSensor',
  thermostat: 'Thermostat',
  garage: 'GarageDoorOpener',
  window: 'Window',
  lock: 'LockMechanism',
};

/**
 * One fhem device as a HomeKit accessory. homebridge asks it for its services once and from
 * then on talks to the characteristics of those.
 *
 * An accessory that was created for a device that is not to be published has no
 * `service_name`. The platform does not hand such an accessory to homebridge.
 */
export class FhemAccessory {
  declare log: Logging;
  declare connection: unknown;
  declare jsFunctions: unknown;

  /** what the device is: a genericDeviceType value or the name of a HomeKit service */
  declare service_name?: string;
  declare mappings: Mappings;
  /** the HomeKit category of the accessory, if the homebridgeMapping attribute names one */
  declare category?: number;

  /** the name homebridge uses for the accessory */
  declare name?: string;
  declare fuuid?: string;
  declare alias?: string;
  declare siriName?: string;
  /** the name of the device in fhem */
  declare device?: string;
  /** the fhem module of the device */
  declare type?: string;
  declare model?: string;
  declare PossibleSets?: string;
  declare room?: string;
  declare serial?: string;
  /** homebridge makes the uuid of the accessory from this */
  declare uuid_base?: string;
  declare displayName?: string;

  /** the platform the accessory belongs to, set by the platform */
  declare fhem?: { scope?: unknown };
  declare historyService?: HistoryService;
  /** the commands that wait to be sent, by the reading id of their mapping */
  declare delayed_timers?: Record<string, ReturnType<typeof setTimeout>>;
  /** set once the history was saved for the shutdown of homebridge */
  declare shutdown?: boolean;

  readonly #state: PluginState;
  readonly #execute: Execute;

  constructor(platform: AccessoryPlatform, s: Jsonlist2Device, state: PluginState, execute: Execute) {
    this.#state = state;
    this.#execute = execute;

    this.log = platform.log;
    this.connection = platform.connection;
    this.jsFunctions = platform.jsFunctions;

    if (state.subscriptions.publishedAccessory(s.Internals.NAME)) {
      this.log.warn(s.Internals.NAME + ' is already published');
      return;
    }

    // eslint-disable-next-line @typescript-eslint/no-unnecessary-condition -- fhem does report devices without them
    if (!s.Readings) {
      this.log.error('ignoring ' + s.Internals.NAME + ' (' + s.Internals.TYPE + ') without readings');
      return;
    }
    // eslint-disable-next-line @typescript-eslint/no-unnecessary-condition -- as above
    if (!s.Attributes) {
      this.log.error('ignoring ' + s.Internals.NAME + ' (' + s.Internals.TYPE + ') without attributes');
      return;
    }

    if (looselyEqual(s.Attributes.disable, 1)) {
      this.log.info(s.Internals.NAME + ' is disabled');
      // and is published all the same
    }

    if (!detectMappings(this, s, state)) {
      return;
    }

    this.fromHomebridgeMapping(s.Attributes.homebridgeMapping);
    this.log.debug('mappings for ' + s.Internals.NAME + ': ' + util.inspect(this.mappings));

    this.log(s.Internals.NAME + ' is ' + this.service_name);

    reviseMappings(this, s);

    this.#logMappings(s);

    Object.assign(this, deviceIdentity(s, this.mappings));

    prepareMappings(this, s, {
      characteristics: state.hap.Characteristic as unknown as Record<string, unknown>,
      cached: state.cache.values,
      update: (informId, value) => {
        state.update(informId, value);
      },
      reading2homekit: reading2homekit,
    });
  }

  #logMappings(s: Jsonlist2Device): void {
    this.log(s.Internals.NAME + ' has');
    for (const characteristic_type in this.mappings) {
      const entry = this.mappings[characteristic_type];
      const mappings = (Array.isArray(entry) ? entry : [entry]) as Mapping[];

      for (const mapping of mappings) {
        const reading = (mapping.device ? mapping.device + '.' : '') + mapping.reading;
        if (characteristic_type === 'On') {
          this.log('  ' + characteristic_type + ' [' + reading + ';' + mapping.cmdOn + ',' + mapping.cmdOff + ']');
        } else if (characteristic_type === 'Hue' || characteristic_type === 'Saturation') {
          this.log('  ' + characteristic_type + ' [' + reading + ';' + mapping.cmd + ';0-' + mapping.max + ']');
        } else if (characteristic_type === 'history') {
          this.log('  ' + characteristic_type + ' [' + (mapping.type ? mapping.type : 'thermo') + ';' + (mapping.size ? mapping.size : 1024) + ']');
        } else if (mapping.name) {
          if (characteristic_type === CustomUUIDs.Volume) {
            this.log('  Custom ' + mapping.name + ' [' + reading + ';' + (mapping.nocache ? 'not cached' : 'cached') + ']');
          } else {
            this.log('  Custom ' + mapping.name + ' [' + reading + ']');
          }
        } else {
          this.log('  ' + characteristic_type + ' [' + reading + ']');
        }
      }
    }
  }

  /**
   * Makes the characteristic follow the reading of the mapping. Given the id of a reading instead
   * of a mapping, the reading is only kept in the cache.
   */
  subscribe(mapping: PreparedMapping | string | undefined, characteristic?: Characteristic): void {
    if (typeof mapping === 'object') {
      mapping.characteristic = characteristic;

      if (characteristic) {
        (characteristic as MappedCharacteristic).FHEM_mapping = mapping;
      }

      this.#state.subscriptions.subscribe(this, mapping.informId as string, characteristic, mapping);
    } else {
      this.#state.subscriptions.subscribe(this, mapping as string, characteristic);
    }
  }

  unsubscribe(mapping?: PreparedMapping | string, characteristic?: Characteristic): void {
    if (mapping === undefined) {
      // only finds subscriptions of single mappings that were made with this characteristic.
      for (const characteristic_type in this.mappings) {
        const each = this.mappings[characteristic_type] as Mapping;
        this.#state.subscriptions.unsubscribe(this, each.informId as string, characteristic);
      }
    } else if (typeof mapping === 'object') {
      mapping.characteristic = characteristic;

      if (characteristic) {
        (characteristic as MappedCharacteristic).FHEM_mapping = mapping;
      }

      this.#state.subscriptions.unsubscribe(this, mapping.informId as string, characteristic);
    } else {
      this.#state.subscriptions.unsubscribe(this, mapping, characteristic);
    }
  }

  fromHomebridgeMapping(homebridgeMapping: string | undefined): void {
    const { Accessory } = this.#state.hap;
    // HAP-NodeJS 2 has the categories elsewhere, so none is found here.
    parseHomebridgeMapping(this, homebridgeMapping, (Accessory as unknown as { Categories?: Record<string, number | undefined> }).Categories);
  }

  /** sends the command for the value after the delay, unless another value for the mapping arrives before */
  delayed(mapping: PreparedMapping, value: unknown, delay?: number | boolean): void {
    this.delayed_timers ??= {};

    let milliseconds = typeof delay !== 'number' ? 1000 : delay;
    if (milliseconds < 500) {
      milliseconds = 500;
    }

    const informId = mapping.informId as string;
    const timer = this.delayed_timers[informId];
    if (timer) {
      clearTimeout(timer);
    }

    this.log.info(this.name + ' delaying command ' + mapping.characteristic_type + ' with value ' + String(value));
    this.delayed_timers[informId] = setTimeout(() => {
      delete this.delayed_timers?.[informId];
      this.command(mapping, value);
    }, milliseconds);
  }

  /** sends the fhem command for a value HomeKit wrote. see commandFor. */
  command(mapping: PreparedMapping | string, value?: unknown): void {
    const command = commandFor(this, mapping, value);
    if (command === undefined) {
      return;
    }

    this.execute(command);
  }

  execute(cmd: string, callback?: (result: string) => void): void {
    this.#execute(this.log, this.connection, cmd, callback);
  }

  /**
   * The value of the characteristic of the mapping: from the cache of the mapping, or from fhem
   * for a mapping that is not cached. Answers the callback, and returns the value if it was cached.
   */
  query(target: PreparedMapping | string, callback?: QueryCallback): HomekitValue | undefined {
    const mapping = target as PreparedMapping;
    let device = this.device;
    let reading: string | undefined;

    if (typeof target === 'object') {
      if (target.device) {
        device = target.device;
      }
      if (target.reading) {
        reading = target.reading;
      }
    } else {
      reading = target;
    }

    if (reading === undefined && mapping.default === undefined) {
      if (callback !== undefined) {
        callback(1);
      }
      return undefined;
    }

    this.log.info('query: ' + (mapping.name ? mapping.name : mapping.characteristic_type) + ' for ' + mapping.informId);
    const cached = mapping.cached;
    if (typeof target === 'object' && cached !== undefined && !('nocache' in target)) {
      let defined: string | undefined = undefined;
      if (mapping.homekit2name !== undefined) {
        defined = mapping.homekit2name[cached as unknown as string];
        if (defined === undefined) {
          defined = '???';
        }
      }

      mapping.log.info('  cached: ' + cached + ' (as ' + typeof cached + (defined ? '; means ' + defined : '') + ')');

      if (callback !== undefined) {
        callback(undefined, cached);
      }
      return cached;
    } else {
      this.log.info('  not cached');
    }

    const cmd = '{ReadingsVal("' + device + '","' + reading + '","")}';

    this.execute(cmd, (result) => {
      const value = result.replace(/[\r\n]/g, '');
      this.log.info('  value: ' + value);

      this.#state.update(mapping.informId as string, value, true);

      if (callback !== undefined) {
        const converted = reading2homekit(mapping, value);
        if (converted === undefined) {
          callback(1);
        } else {
          callback(undefined, converted);
        }
      }
    });
    return undefined;
  }

  isInRoom(room: string | undefined): boolean {
    if (!room) {
      return false;
    }
    if (!this.room) {
      return false;
    }
    if (this.room.toLowerCase() === room) {
      return true;
    }
    if (this.room.toLowerCase().match('(^|,)(' + room + ')(,|$)')) {
      return true;
    }
    return false;
  }

  isOfType(type: string | undefined): boolean {
    if (!type) {
      return false;
    }
    if (this.service_name === type) {
      return true;
    }
    return false;
  }

  /** whether the accessory is meant for the scope, e.g. `siri`. it is unless the platform names scopes without it. */
  isInScope(scope: string): boolean {
    if (this.fhem === undefined) {
      return true;
    }
    const scopes = this.fhem.scope;
    if (scopes === undefined) {
      return true;
    }

    if (typeof scopes === 'object') {
      // a list has no grep, so this fails.
      if ((scopes as { grep(scope: string): number }).grep(scope) !== -1) {
        return true;
      }
    } else {
      if ((scopes as string).match('(^|,)(' + scope + ')(,|$)')) {
        return true;
      }
    }

    return false;
  }

  /** a new service for a genericDeviceType value or the name of a HomeKit service. undefined if there is no such service. */
  serviceOfName(service_name: string | undefined, subtype?: string): NamedService | undefined {
    const translated = serviceNameOfGenericDeviceType[service_name as string];
    const serviceName = translated !== undefined ? translated : service_name;

    const serviceClass = (this.#state.hap.Service as unknown as Record<string, unknown>)[serviceName as string];
    if (typeof serviceClass === 'function') {
      let name = this.siriName;
      if (subtype) {
        name = subtype + ' - ' + this.siriName;
      }

      this.log('  ' + serviceName + ' service for ' + this.name + (subtype ? ' (' + subtype + ')' : ''));
      const service = new (serviceClass as new (name?: string, subtype?: string) => NamedService)(name, subtype ? subtype : '');
      service.service_name = serviceName as string;
      return service;
    }

    if (serviceClass === undefined) {
      this.log.error(this.name + ': service name ' + serviceName + ' unknown');
    }

    return undefined;
  }

  /** the HomeKit characteristic class for the key of a mapping, `<service>#<characteristic>` or the characteristic alone */
  characteristicOfName(name: string): CharacteristicClass | undefined {
    const parts = name.split('#');
    const characteristicName = parts[1] ? parts[1] : name;

    const characteristic = (this.#state.hap.Characteristic as unknown as Record<string, unknown>)[characteristicName];
    if (typeof characteristic === 'function') {
      return characteristic as CharacteristicClass;
    }

    return undefined;
  }

  /** like serviceOfName, with a switch for a name there is no service for */
  createDeviceService(service_name: string | undefined, subtype?: string): NamedService {
    let name = this.siriName;
    if (subtype) {
      name = subtype + ' - ' + this.siriName;
    }

    const service = this.serviceOfName(service_name, subtype);
    if (typeof service === 'object') {
      return service;
    }

    this.log('  switch service (default) for ' + this.name + ' (' + subtype + ')');
    return new this.#state.hap.Service.Switch(name, subtype);
  }

  /** HomeKit asks the accessory to show which one it is */
  identify(callback: () => void): void {
    this.log('[' + this.name + '] identify requested!');
    if ((this.PossibleSets as string).match(/(^| )toggle\b/)) {
      this.command('identify');
    }
    callback();
  }

  getServices(): Service[] {
    return createServices(this, this.#state);
  }
}
