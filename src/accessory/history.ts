// the history Eve shows, kept by the fakegato-history package
import util from 'node:util';
import type { Service } from '@homebridge/hap-nodejs';
import type { HomekitValue, Mapping, PreparedMapping } from '../mapping/types.ts';
import type { PluginState } from '../state/pluginState.ts';
import type { SubscribedAccessory } from '../state/subscriptions.ts';
import { CustomUUIDs } from './customCharacteristics.ts';

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
  accessory: SubscribedAccessory, historyService: HistoryService, mapping: PreparedMapping, value: HomekitValue, state: PluginState,
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
    } else if (mapping.characteristic_type === 'CurrentTemperature'
               || mapping.characteristic_type === 'TargetTemperature'
               || mapping.characteristic_type === CustomUUIDs.Actuation) {
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
      // the level of the air quality, not a concentration. see docs/KNOWN_BUGS.md, 20.
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
