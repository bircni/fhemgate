// the history Eve shows, kept by the fakegato-history package
import util from 'node:util';
import type { Characteristic, CharacteristicValue, Service } from '@homebridge/hap-nodejs';
import type { HomekitValue, Mapping, PreparedMapping } from '../mapping/types.ts';
import type { PluginState } from '../state/pluginState.ts';
import type { SubscribedAccessory } from '../state/subscriptions.ts';
import type { FhemAccessory, NamedService } from './accessory.ts';
import { CustomUUIDs, EveUUIDs } from './customCharacteristics.ts';
import type { CustomCharacteristicClass } from './services.ts';

/** what Eve keeps besides the entries, for contact and motion sensors */
export interface ExtraPersistedData {
  TimesOpened?: number;
  LastActivation?: number;
  OpenDuration?: number;
  ClosedDuration?: number;
  reset?: number;
}

/** the history service of fakegato-history, as far as the plugin uses it */
export interface HistoryService extends Service {
  isHistoryLoaded(): boolean;
  getExtraPersistedData(): ExtraPersistedData;
  setExtraPersistedData(data: ExtraPersistedData): void;
  addEntry(entry: object): void;
  /** seconds since the epoch of the first entry, undefined for an empty history */
  getInitialTime(): number | undefined;
  save(): void;

  /** kept by the plugin at the service: the extra data as last loaded */
  extra_persist: ExtraPersistedData;
}

/** the class fakegato-history exports for a homebridge */
export type HistoryServiceClass = new (type: string, accessory: unknown, options: { size: number | string; storage: string }) => HistoryService;

const cachedOf = (mapping: Mapping | Mapping[] | undefined): HomekitValue | undefined => (mapping as Mapping | undefined)?.cached;

/** adds the new value of a characteristic to the history of its accessory, if it is one the history has a place for */
export function recordHistory(
  accessory: SubscribedAccessory,
  historyService: HistoryService,
  mapping: PreparedMapping,
  value: HomekitValue,
  state: PluginState,
): void {
  let extra_persist: ExtraPersistedData = {};
  if (historyService.isHistoryLoaded()) {
    extra_persist = historyService.getExtraPersistedData();
  }
  historyService.extra_persist = extra_persist;

  if (mapping.name === 'Custom TimesOpened') {
    historyService.extra_persist.TimesOpened = value as number;
  } else if (mapping.name === 'Custom LastActivation') {
    historyService.extra_persist.LastActivation = value as number;
  } else {
    let entry: Record<string, unknown> | undefined = { time: mapping.last_update };
    if (mapping.characteristic_type === 'ContactSensorState') {
      entry.status = value;
      if (value === state.hap.Characteristic.ContactSensorState.CONTACT_NOT_DETECTED) {
        const timesOpened = (historyService.extra_persist.TimesOpened as number) + 1;
        historyService.extra_persist.TimesOpened = timesOpened;
        state.update(mapping.device + '-EVE-TimesOpened', timesOpened);
      }
    } else if (mapping.characteristic_type === 'MotionDetected') {
      entry.status = value ? 1 : 0;
    } else if (
      mapping.characteristic_type === 'CurrentTemperature' ||
      mapping.characteristic_type === 'TargetTemperature' ||
      mapping.characteristic_type === CustomUUIDs.Actuation
    ) {
      const current = accessory.mappings.CurrentTemperature ? cachedOf(accessory.mappings.CurrentTemperature) : undefined;

      if (accessory.mappings.TargetTemperature) {
        const target = cachedOf(accessory.mappings.TargetTemperature);
        if (target !== undefined) {
          entry.setTemp = target;
        }
        if (current !== undefined) {
          entry.currentTemp = current;
        }
      } else if (current !== undefined) {
        entry.temp = current;
      }

      if (accessory.mappings[CustomUUIDs.Actuation]) {
        const valve = cachedOf(accessory.mappings[CustomUUIDs.Actuation]);
        if (valve !== undefined) {
          entry.valvePosition = valve;
        }
      }
    } else if (mapping.characteristic_type === 'CurrentRelativeHumidity') {
      entry.humidity = value;
    } else if (mapping.characteristic_type === 'AirQuality') {
      // the level of the air quality, not a concentration.
      entry.ppm = value;
    } else if (mapping.characteristic_type === CustomUUIDs.AirPressure) {
      entry.pressure = value;
    } else if (mapping.characteristic_type === CustomUUIDs.Power) {
      entry.power = value;
    } else {
      entry = undefined;
    }

    if (entry !== undefined) {
      mapping.log.info('      adding history entry ' + util.inspect(entry));
      historyService.addEntry(entry);
    }
  }
}

/** the kind of history fakegato-history keeps for a service */
function historyTypeOf(service_name: string): string | undefined {
  switch (service_name) {
    case 'AirQualitySensor':
      return 'room';
    case 'TemperatureSensor':
      return 'weather';
    case 'Thermostat':
      return 'thermo';
    case 'ContactSensor':
      return 'door';
    case 'MotionSensor':
      return 'motion';
    default:
      return undefined;
  }
}

/**
 * Creates the history service for a `history` mapping and adds it to the services.
 * The mapping can carry the type of the history and its size in entries.
 */
export function addHistoryService(accessory: FhemAccessory, state: PluginState, services: Service[], mapping: PreparedMapping, service_name: string): void {
  const { Characteristic, Formats, Perms } = state.hap;
  const log = accessory.log;

  if (!state.historyServiceClass) {
    log.error(accessory.name + ': fakegato-history not installed');
    return;
  }
  if (accessory.historyService) {
    log.error(accessory.name + ': FakeGatoHistory already created for' + service_name);
    return;
  }

  const type = mapping.type ? mapping.type : historyTypeOf(service_name);
  if (!type) {
    log.error(accessory.name + ': history: no type known for ' + service_name);
    return;
  }

  log('  FakeGatoHistory service with type ' + type + ' for ' + service_name);
  const historyService = new state.historyServiceClass(type, accessory, { size: mapping.size ? mapping.size : 1024, storage: 'fs' });
  accessory.historyService = historyService;
  services.push(historyService);

  let hasExtra = false;
  if (service_name === 'ContactSensor') {
    historyService.extra_persist = { TimesOpened: 0, LastActivation: 0, OpenDuration: 0, ClosedDuration: 0, reset: 0 };
    historyService.setExtraPersistedData(historyService.extra_persist);
    hasExtra = true;
  } else if (service_name === 'MotionSensor') {
    historyService.extra_persist = { LastActivation: 0, reset: 0 };
    historyService.setExtraPersistedData(historyService.extra_persist);
    hasExtra = true;
  }

  if (hasExtra) {
    // the history is read from disk in the background. looks every 10 milliseconds until it is there.
    const checkIfLoaded = (): void => {
      if (historyService.isHistoryLoaded()) {
        const extra_persist = historyService.getExtraPersistedData() as ExtraPersistedData | undefined;
        if (extra_persist !== undefined) {
          historyService.extra_persist = extra_persist;
          log(accessory.name + ': FakeGatoHistory extra persisted data loaded');
          if (historyService.extra_persist.TimesOpened !== undefined) {
            state.update(mapping.device + '-EVE-TimesOpened', historyService.extra_persist.TimesOpened);
          }
        } else {
          log(accessory.name + ': FakeGatoHistory extra persisted data is empty');
        }
      } else {
        setTimeout(checkIfLoaded, 10);
      }
    };

    checkIfLoaded();
  }

  if (service_name === 'ContactSensor') {
    log('    FakeGatoHistory reset');
    const characteristic = new (Characteristic as unknown as CustomCharacteristicClass)('Reset', EveUUIDs.Reset);
    historyService.addCharacteristic(characteristic);
    characteristic.setProps({ format: Formats.UINT32 });
    characteristic.setProps({ perms: [Perms.PAIRED_READ, Perms.PAIRED_WRITE] });
    log.debug('      props: ' + util.inspect(characteristic.props));
    characteristic
      .on('set', (value, callback, context) => {
        if (context !== 'fromFHEM') {
          // eslint-disable-next-line @typescript-eslint/no-base-to-string -- logged as it comes
          log('set reset: ' + String(value));
          historyService.extra_persist.reset = value as number;
          state.update(mapping.device + '-EVE-TimesOpened', 0);
        }
        callback();
      })
      .on('get', (callback) => {
        let value = historyService.extra_persist.reset;
        if (value === undefined) {
          value = 0;
        }
        log('get reset: ' + value);
        callback(null, value);
      });
  }
}

/**
 * Adds the characteristics Eve reads the counters of a contact or motion sensor from.
 *
 * They are added to the service the last mapping of the accessory ended up on, and read from
 * that mapping, whichever it was.
 */
export function addEveCharacteristics(
  accessory: FhemAccessory,
  state: PluginState,
  controlService: NamedService,
  mapping: PreparedMapping,
  service_name: string,
  seen: Record<string, boolean | undefined>,
): void {
  const { Formats, Perms } = state.hap;
  const Custom = state.hap.Characteristic as unknown as CustomCharacteristicClass;
  const log = accessory.log;
  const from = mapping.device + ':' + mapping.reading;

  const answerZero =
    (name: string) =>
    (callback: (error: null, value: CharacteristicValue) => void): void => {
      const value = 0;
      log('query Custom ' + name + ' for ' + from + ': ' + value);
      callback(null, value);
    };

  let characteristic: Characteristic;
  if (accessory.mappings.ContactSensorState) {
    log('    Custom TimesOpened characteristic ' + from);
    characteristic = new Custom('TimesOpened', EveUUIDs.TimesOpened);
    const timesOpened = { name: 'Custom TimesOpened', characteristic: characteristic, informId: mapping.device + '-EVE-TimesOpened', log: mapping.log };
    accessory.mappings[EveUUIDs.TimesOpened] = timesOpened;
    accessory.subscribe(timesOpened, characteristic);
    controlService.addCharacteristic(characteristic);
    characteristic.setProps({ format: Formats.UINT32 });
    characteristic.setProps({ perms: [Perms.PAIRED_READ, Perms.NOTIFY] });
    characteristic.on('get', (callback) => {
      const historyService = accessory.historyService;
      if (!historyService) {
        log.error(accessory.name + ': Custom TimesOpened characteristic requires FakeGatoHistory');
        callback('no historyService' as unknown as Error);
        return;
      }

      const value = historyService.extra_persist.TimesOpened;
      log('query Custom TimesOpened for ' + from + ': ' + value);
      callback(null, value);
    });
  }

  if ((accessory.mappings.ContactSensorState || accessory.mappings.MotionDetected) && !seen[service_name + '#' + EveUUIDs.LastActivation]) {
    seen[service_name + '#' + EveUUIDs.LastActivation] = true;
    log('    Custom LastActivation characteristic ' + from);
    characteristic = new Custom('LastActivation', EveUUIDs.LastActivation);
    accessory.mappings[EveUUIDs.LastActivation] = { characteristic: characteristic };
    controlService.addCharacteristic(characteristic);
    characteristic.setProps({ format: Formats.UINT32 });
    characteristic.setProps({ perms: [Perms.PAIRED_READ] });
    log.debug('      props: ' + util.inspect(characteristic.props));
    characteristic.on('get', (callback) => {
      const historyService = accessory.historyService;
      if (historyService === undefined) {
        log.error(accessory.name + ': Custom LastActivation characteristic requires FakeGatoHistory');
        callback('error' as unknown as Error);
        return;
      }
      if (mapping.last_update === undefined) {
        log.error(accessory.name + ': Custom LastActivation characteristic: last update unknown ');
        callback('error' as unknown as Error);
        return;
      }

      // an empty history is started with the current state. the time is then still asked from
      // the history, which answers nothing.
      if (historyService.getInitialTime() === undefined) {
        const entry = { time: mapping.last_update, status: mapping.cached };
        mapping.log.info('      adding history entry ' + util.inspect(entry));
        historyService.addEntry(entry);
      }

      const time = mapping.last_update - (historyService.getInitialTime() as number);

      log('query Custom LastActivation for ' + from + ': ' + time);
      callback(null, time);
    });
  }

  if (accessory.mappings.ContactSensorState) {
    log('    Custom OpenDuration characteristic ' + from);
    characteristic = new Custom('OpenDuration', EveUUIDs.OpenDuration);
    controlService.addCharacteristic(characteristic);
    characteristic.setProps({ format: Formats.UINT32 });
    characteristic.setProps({ perms: [Perms.PAIRED_READ, Perms.PAIRED_WRITE, Perms.NOTIFY] });
    characteristic.on('get', answerZero('OpenDuration'));

    log('    Custom ClosedDuration characteristic ' + from);
    characteristic = new Custom('ClosedDuration', EveUUIDs.ClosedDuration);
    controlService.addCharacteristic(characteristic);
    characteristic.setProps({ format: Formats.UINT32 });
    characteristic.setProps({ perms: [Perms.PAIRED_READ, Perms.PAIRED_WRITE, Perms.NOTIFY] });
    characteristic.on('get', answerZero('ClosedDuration'));
  }
}
