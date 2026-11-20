import util from 'node:util';
import type { Characteristic, CharacteristicValue, Service } from '@homebridge/hap-nodejs';
import type { Logging } from 'homebridge';
import { detectMappings, reviseMappings, type Detection } from '../devices/detect.ts';
import { deviceIdentity } from '../devices/identity.ts';
import { identityKey, type IdentityStore } from '../devices/identityStore.ts';
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
  /** false if mappings must not carry JavaScript */
  allowInlineFunctions?: boolean;
  /** what each device was first published as. without it a device is what is worked out for it now. */
  identities?: IdentityStore;
}

/**
 * Milliseconds fhem has to answer a read of a characteristic before HomeKit is answered without
 * it. homebridge calls a plugin slow that takes three seconds, and HomeKit shows the whole
 * accessory as not responding soon after.
 */
export const QUERY_TIMEOUT = 2000;

/** milliseconds in which fhem is asked at most once for a reading that HomeKit reads from the cache */
export const READ_REFRESH_INTERVAL = 60 * 1000;

/**
 * Why a device fhem listed is no accessory: listed twice, without readings or attributes, left
 * out on purpose (`ignored`), or nothing was recognised of it (`undetected`).
 */
export type Skipped = 'duplicate' | 'noReadings' | 'noAttributes' | Exclude<Detection, 'detected'>;

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

// the names HAP-NodeJS had for some services and characteristics before its version 2. existing
// homebridgeMapping attributes use them, so they stay known.
const renamedServices: Record<string, string | undefined> = {
  BatteryService: 'Battery',
  Slat: 'Slats',
  Label: 'ServiceLabel',
  Relay: 'CloudRelay',
  TunneledBTLEAccessoryService: 'Tunnel',
  CameraEventRecordingManagement: 'CameraRecordingManagement',
};
const renamedCharacteristics: Record<string, string | undefined> = {
  LabelIndex: 'ServiceLabelIndex',
  LabelNamespace: 'ServiceLabelNamespace',
  PairingPairings: 'ListPairings',
  SelectedStreamConfiguration: 'SelectedRTPStreamConfiguration',
};

/** the class HAP-NodeJS has under the name, or under the name it gave it since */
function classOfName(classes: Record<string, unknown>, renamed: Record<string, string | undefined>, name: string): { name: string; found: unknown } {
  const current = Object.hasOwn(renamed, name) ? renamed[name] : undefined;
  if (classes[name] === undefined && current !== undefined) {
    return { name: current, found: classes[current] };
  }
  return { name, found: classes[name] };
}

/**
 * One fhem device as a HomeKit accessory. homebridge asks it for its services once and from
 * then on talks to the characteristics of those.
 *
 * An accessory that was created for a device that is not to be published says why in
 * `skipped`. The platform does not hand such an accessory to homebridge.
 */
export class FhemAccessory {
  declare log: Logging;
  declare connection: unknown;
  declare jsFunctions: unknown;

  /** what the device is: a genericDeviceType value or the name of a HomeKit service */
  declare service_name?: string;
  /** why the device was turned down when the accessory was made for it. the platform may still leave out one that was not. */
  declare skipped?: Skipped;
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
  /** the commands that wait to be sent, by the reading id and the characteristic of their mapping */
  declare delayed_timers?: Record<string, ReturnType<typeof setTimeout>>;
  /** set once the history was saved for the shutdown of homebridge */
  declare shutdown?: boolean;

  readonly #state: PluginState;
  /** the url of the FHEMWEB of the connection, none for an accessory of no fhem the plugin talks to */
  get #baseUrl(): string | undefined {
    return (this.connection as { base_url?: string } | undefined)?.base_url;
  }
  readonly #execute: Execute;
  #services?: Service[];
  /** when fhem was last asked for a reading that is cached, by the id of the reading */
  readonly #refreshed = new Map<string, number>();

  constructor(platform: AccessoryPlatform, s: Jsonlist2Device, state: PluginState, execute: Execute) {
    this.#state = state;
    this.#execute = execute;

    this.log = platform.log;
    this.connection = platform.connection;
    this.jsFunctions = platform.jsFunctions;

    if (state.subscriptions.publishedAccessory(s.Internals.NAME)) {
      this.log.warn(s.Internals.NAME + ' is already published');
      this.skipped = 'duplicate';
      return;
    }

    // eslint-disable-next-line @typescript-eslint/no-unnecessary-condition -- fhem does report devices without them
    if (!s.Readings) {
      this.log.error('ignoring ' + s.Internals.NAME + ' (' + s.Internals.TYPE + ') without readings');
      this.skipped = 'noReadings';
      return;
    }
    // eslint-disable-next-line @typescript-eslint/no-unnecessary-condition -- as above
    if (!s.Attributes) {
      this.log.error('ignoring ' + s.Internals.NAME + ' (' + s.Internals.TYPE + ') without attributes');
      this.skipped = 'noAttributes';
      return;
    }

    if (looselyEqual(s.Attributes.disable, 1)) {
      this.log.info(s.Internals.NAME + ' is disabled');
      // and is published all the same
    }

    const detection = detectMappings(this, s, state);
    if (detection !== 'detected') {
      this.skipped = detection;
      return;
    }

    this.fromHomebridgeMapping(s.Attributes.homebridgeMapping);
    this.log.debug('mappings for ' + s.Internals.NAME + ': ' + util.inspect(this.mappings));

    // the one line every device gets at the usual log level. the rest is there with debug logging.
    this.log(s.Internals.NAME + ' is ' + this.service_name);

    reviseMappings(this, s);

    this.#logMappings(s);

    const identities = platform.identities;
    const baseUrl = this.#baseUrl;
    Object.assign(
      this,
      deviceIdentity(
        s,
        this.mappings,
        identities && ((computed) => identities.resolve(identityKey(baseUrl, s.Internals.NAME, s.Internals.FUUID), computed, this.log)),
      ),
    );

    prepareMappings(this, s, {
      characteristics: state.hap.Characteristic as unknown as Record<string, unknown>,
      cached: state.cache.values,
      update: (informId, value) => {
        state.update(informId, value);
      },
      reading2homekit: reading2homekit,
      allowInlineFunctions: platform.allowInlineFunctions,
    });
  }

  #logMappings(s: Jsonlist2Device): void {
    this.log.debug(s.Internals.NAME + ' has');
    for (const characteristic_type in this.mappings) {
      const entry = this.mappings[characteristic_type];
      const mappings = (Array.isArray(entry) ? entry : [entry]) as Mapping[];

      for (const mapping of mappings) {
        let reading = (mapping.device ? mapping.device + '.' : '') + mapping.reading;
        if (mapping.reading === undefined && mapping.default !== undefined) {
          reading = 'default ' + mapping.default;
        }
        if (characteristic_type === 'On') {
          this.log.debug('  ' + characteristic_type + ' [' + reading + ';' + mapping.cmdOn + ',' + mapping.cmdOff + ']');
        } else if (characteristic_type === 'Hue' || characteristic_type === 'Saturation') {
          this.log.debug('  ' + characteristic_type + ' [' + reading + ';' + mapping.cmd + ';0-' + mapping.max + ']');
        } else if (characteristic_type === 'history') {
          this.log.debug('  ' + characteristic_type + ' [' + (mapping.type ? mapping.type : 'thermo') + ';' + (mapping.size ? mapping.size : 1024) + ']');
        } else if (mapping.name) {
          if (characteristic_type === CustomUUIDs.Volume) {
            this.log.debug('  Custom ' + mapping.name + ' [' + reading + ';' + (mapping.nocache ? 'not cached' : 'cached') + ']');
          } else {
            this.log.debug('  Custom ' + mapping.name + ' [' + reading + ']');
          }
        } else {
          this.log.debug('  ' + characteristic_type + ' [' + reading + ']');
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

      // a mapping with only a default has no reading to follow
      if (mapping.informId !== undefined) {
        this.#state.subscriptions.subscribe(this, mapping.informId, characteristic, mapping);
      }
    } else {
      this.#state.subscriptions.subscribe(this, mapping as string, characteristic);
    }
  }

  /**
   * Ends what subscribe started for the mapping, or the id of a reading, and the characteristic.
   * Without a mapping every subscription of the accessory ends.
   */
  unsubscribe(mapping?: PreparedMapping | string, characteristic?: Characteristic): void {
    if (mapping === undefined) {
      this.#state.subscriptions.unsubscribeAll(this);
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
    // the types declare the categories as a const enum, which can not be handed on as a value.
    // HAP-NodeJS does export the object.
    const { Categories } = this.#state.hap as unknown as { Categories?: Record<string, number | string | undefined> };
    parseHomebridgeMapping(this, homebridgeMapping, Categories);
  }

  /** sends the command for the value after the delay, unless another value for the characteristic arrives before */
  delayed(mapping: PreparedMapping, value: unknown, delay?: number | boolean): void {
    this.delayed_timers ??= {};

    let milliseconds = typeof delay !== 'number' ? 1000 : delay;
    if (milliseconds < 500) {
      milliseconds = 500;
    }

    // two characteristics can follow the same reading, like the position and the tilt of a
    // blind. each has its own command waiting, so the reading alone does not tell them apart.
    const pending = mapping.informId + ' ' + mapping.characteristic_type + (mapping.subtype ? '(' + mapping.subtype + ')' : '');
    const timer = this.delayed_timers[pending];
    if (timer) {
      clearTimeout(timer);
    }

    this.log.info(this.name + ' delaying command ' + mapping.characteristic_type + ' with value ' + String(value));
    this.delayed_timers[pending] = setTimeout(() => {
      delete this.delayed_timers?.[pending];
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
   * Whether the fhem of the accessory answers. HomeKit is told that the device does not respond
   * while it does not: a value from before could be wrong by now, and a command would be lost.
   * An accessory of no fhem the plugin talks to is taken for reachable.
   */
  isReachable(): boolean {
    const url = this.#baseUrl;
    return url === undefined || this.#state.longpoll[url]?.reachable === true;
  }

  /**
   * The value of the characteristic of the mapping: from the cache of the mapping, or from fhem
   * for a mapping that is not cached. Answers the callback, and returns the value if it was cached.
   *
   * Given the name of a reading of the device instead of a mapping, fhem is asked for it and the
   * callback gets the text of the reading.
   */
  query(target: PreparedMapping | string, callback?: QueryCallback): HomekitValue | undefined {
    const mapping = typeof target === 'object' ? target : undefined;
    let device = this.device;
    let reading: string | undefined;

    if (mapping) {
      if (mapping.device) {
        device = mapping.device;
      }
      if (mapping.reading) {
        reading = mapping.reading;
      }
    } else {
      reading = target as string;
    }

    if (reading === undefined && mapping?.default === undefined) {
      if (callback !== undefined) {
        callback(1);
      }
      return undefined;
    }

    if (reading === undefined) {
      // only a default: there is no reading to ask fhem for
      const value = mapping?.cached ?? mapping?.default;
      if (callback !== undefined) {
        callback(undefined, value);
      }
      return value;
    }

    const informId = mapping ? (mapping.informId as string) : device + '-' + reading;

    this.log.debug('query: ' + (mapping ? (mapping.name ? mapping.name : mapping.characteristic_type) : reading) + ' for ' + informId);
    const cached = mapping?.cached;
    const cmd = '{ReadingsVal("' + device + '","' + reading + '","")}';

    if (mapping && cached !== undefined && !('nocache' in mapping)) {
      let defined: string | undefined = undefined;
      if (mapping.homekit2name !== undefined) {
        defined = mapping.homekit2name[cached as unknown as string];
        if (defined === undefined) {
          defined = '???';
        }
      }

      mapping.log.debug('  cached: ' + cached + ' (as ' + typeof cached + (defined ? '; means ' + defined : '') + ')');

      if (callback !== undefined) {
        callback(undefined, cached);
        this.#refresh(informId, cmd);
      }
      return cached;
    } else {
      this.log.debug('  not cached');
    }

    // HomeKit is not left waiting when fhem takes its time: it gets the value last seen, or an
    // error if there never was one, and the answer of fhem is published when it comes
    let timedOut = false;
    const timer =
      callback &&
      setTimeout(() => {
        timedOut = true;
        if (cached !== undefined) {
          this.log.debug('query: no answer from fhem for ' + informId + ' within ' + QUERY_TIMEOUT / 1000 + ' seconds, answering with the last value');
          callback(undefined, cached);
        } else {
          this.log.error('query: no answer from fhem for ' + informId + ' within ' + QUERY_TIMEOUT / 1000 + ' seconds');
          callback(this.#state.hap.HAPStatus.OPERATION_TIMED_OUT);
        }
      }, QUERY_TIMEOUT);

    const before = this.#state.cache.get(informId);
    this.execute(cmd, (result) => {
      clearTimeout(timer);
      const value = result.replace(/[\r\n]/g, '');
      this.log.debug('  value: ' + value);

      if (callback === undefined) {
        this.#answered(mapping, informId, value, before);
        return;
      }

      // the read that waited gets the value as its answer. one that was answered meanwhile is
      // told with an update like any change in fhem.
      this.#state.update(informId, value, !timedOut);

      if (!timedOut) {
        // without a mapping there is nothing to convert the reading with
        const converted = mapping ? reading2homekit(mapping, value) : value;
        if (converted === undefined) {
          callback(1);
        } else {
          callback(undefined, converted);
        }
      }
    });
    return undefined;
  }

  /**
   * Takes what fhem answered to a question nobody waits for, as asked while the accessory was
   * built: it goes to the cache, and to the characteristic of the mapping that asked. Not when
   * fhem has no such reading and answers nothing, not when an event arrived meanwhile, which is
   * newer, and not to a characteristic that only tells of presses of a button.
   */
  #answered(mapping: PreparedMapping | undefined, informId: string, value: string, before: unknown): void {
    if (value === '' || this.#state.cache.get(informId) !== before) {
      return;
    }
    this.#state.update(informId, value, true);

    const characteristic = mapping?.characteristic;
    if (mapping === undefined || typeof characteristic !== 'object' || this.#state.isEventOnly(characteristic)) {
      return;
    }
    const converted = reading2homekit(mapping, value);
    if (converted !== undefined) {
      characteristic.updateValue(converted as CharacteristicValue);
    }
  }

  /**
   * Asks fhem for a reading whose cached value was just handed to HomeKit, and takes over what
   * it answers if that differs. The events of the long poll keep the cache current, so this
   * only matters when one was missed, and a reading is asked for at most once in
   * READ_REFRESH_INTERVAL however often HomeKit reads it.
   */
  #refresh(informId: string, cmd: string): void {
    const now = Date.now();
    const last = this.#refreshed.get(informId);
    if (last !== undefined && now - last < READ_REFRESH_INTERVAL) {
      return;
    }
    this.#refreshed.set(informId, now);

    const before = this.#state.cache.get(informId);
    this.execute(cmd, (result) => {
      const value = result.replace(/[\r\n]/g, '');
      // fhem answers with nothing for a reading it does not have. and an event that arrived while
      // fhem was asked is newer than the answer.
      if (value !== '' && this.#state.cache.get(informId) === before) {
        this.#state.update(informId, value);
      }
    });
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

    if (Array.isArray(scopes)) {
      if (scopes.includes(scope)) {
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
    const given = translated !== undefined ? translated : service_name;

    const services = this.#state.hap.Service as unknown as Record<string, unknown>;
    const { name: serviceName, found: serviceClass } = classOfName(services, renamedServices, given as string);
    if (typeof serviceClass === 'function') {
      let name = this.siriName;
      if (subtype) {
        name = subtype + ' - ' + this.siriName;
      }

      this.log.debug('  ' + serviceName + ' service for ' + this.name + (subtype ? ' (' + subtype + ')' : ''));
      const service = new (serviceClass as new (name?: string, subtype?: string) => NamedService)(name, subtype ? subtype : '');
      service.service_name = serviceName;
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

    const characteristics = this.#state.hap.Characteristic as unknown as Record<string, unknown>;
    const characteristic = classOfName(characteristics, renamedCharacteristics, characteristicName).found;
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

    this.log.debug('  switch service (default) for ' + this.name + ' (' + subtype + ')');
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

  /** builds the services before homebridge asks for them, so that whoever calls can deal with a device they can not be built for */
  prepareServices(): void {
    this.#services = createServices(this, this.#state);
  }

  /** the services homebridge publishes for the accessory: the prepared ones, or a new set */
  getServices(): Service[] {
    return this.#services ?? createServices(this, this.#state);
  }
}
