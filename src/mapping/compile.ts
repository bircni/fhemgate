// prepares the mappings of a new accessory: works out what the detection and the
// homebridgeMapping attribute left open, builds the lookup tables for values and commands,
// and takes the first values from the readings of the device
import util from 'node:util';
import type { Logging } from 'homebridge';
import type { Jsonlist2Device } from '../devices/types.ts';
import { looselyEqual, toInt } from '../util/loose.ts';
import { isNocache, type CharacteristicClass, type HomekitValue, type Mappings, type PreparedMapping } from './types.ts';
import { resolveConverter } from './userFunctions.ts';

/** the accessory the mappings belong to */
export interface MappingOwner {
  /** the name of the fhem device */
  device?: string;
  log: Logging;
  /** the functions of the jsFunctions file of the platform */
  jsFunctions?: unknown;
  mappings: Mappings;
  /** asks fhem for the reading of a mapping */
  query: (mapping: PreparedMapping) => unknown;
  characteristicOfName: (name: string) => CharacteristicClass | undefined;
}

/** what the preparation needs from the plugin around the accessory */
export interface PrepareEnvironment {
  /** the characteristic classes of HomeKit by name, for the names of their values */
  characteristics: Record<string, unknown>;
  /** the readings known so far, by `<device>-<reading>` */
  cached: Record<string, unknown>;
  /** when those readings last changed, as the plugin learned of it, in seconds since 1970 */
  changed: Record<string, number>;
  /** takes a reading into the cache and tells the characteristics that are subscribed to it */
  update: (informId: string, value: unknown) => void;
  /** converts a reading with a mapping */
  reading2homekit: (mapping: PreparedMapping, reading: unknown) => HomekitValue | undefined;
  /** false if the platform accepts no JavaScript between braces in a mapping */
  allowInlineFunctions?: boolean;
}

type ValueNames = Record<string, unknown> | undefined;

/** the name a characteristic class gives one of its values, e.g. `HEAT` for 1 */
function nameOfValue(names: Record<string, unknown>, value: string | number): string | undefined {
  if (value === '') {
    return undefined;
  }
  // the values are the numbers the class itself defines. what it inherits is none of them.
  for (const [name, defined] of Object.entries(names)) {
    if (typeof defined === 'number' && looselyEqual(value, defined)) {
      return name;
    }
  }
  return undefined;
}

export function prepareMappings(owner: MappingOwner, s: Jsonlist2Device, environment: PrepareEnvironment): void {
  // the key changes within a list of mappings: the first mapping of a list is stored under
  // `<service>#<characteristic>`, the following ones only see the characteristic.
  for (let characteristic_type in owner.mappings) {
    const entry = owner.mappings[characteristic_type];
    const mappings = (Array.isArray(entry) ? entry : [entry]) as PreparedMapping[];

    for (const mapping of mappings) {
      let device = owner.device;
      if (mapping.device === undefined) {
        mapping.device = device;
      } else {
        device = mapping.device;
      }

      if (mapping.reading === undefined && mapping.default === undefined) {
        mapping.reading = 'state';
      }

      mapping.characteristic = owner.characteristicOfName(characteristic_type);
      // a mapping with only a default has no reading to hear from. its id is removed again below.
      mapping.informId = device + '-' + mapping.reading;
      mapping.characteristic_type = characteristic_type;
      mapping.log = owner.log;

      const parts = characteristic_type.split('#');
      if (parts[1]) {
        characteristic_type = parts[1];
      }
      // the class the owner found knows the names of its values, also when the mapping calls it by an older name
      const names = (mapping.characteristic ?? environment.characteristics[characteristic_type]) as ValueNames;

      //FIXME: better integrate eventMap
      if (s.Attributes.eventMap) {
        for (const part of s.Attributes.eventMap.split(' ')) {
          const map = part.split(':') as [string, ...string[]];
          if (map[1] && (map[1].toLowerCase() === 'on' || map[1].toLowerCase() === 'off')) {
            if (!mapping.event_map) {
              mapping.event_map = {};
            }
            mapping.event_map[map[0]] = map[1];
          }
        }
        if (mapping.event_map && Object.keys(mapping.event_map).length) {
          // eslint-disable-next-line @typescript-eslint/no-base-to-string -- logged as it always was
          owner.log.debug('event_map: ' + String(mapping.event_map));
        }
      }

      if (mapping.default !== undefined) {
        const number = names?.[mapping.default as string];
        if (names && number !== undefined) {
          if (mapping.homekit2name === undefined) {
            mapping.homekit2name = {};
          }
          mapping.homekit2name[number as string] = mapping.default as string;
          mapping.default = number as HomekitValue;
        }
        if (typeof mapping.default === 'string') {
          mapping.default = mapping.default.replace(/\+/g, ' ');
        }
        owner.log.debug('default: ' + mapping.default);
      }

      if (typeof mapping.values === 'object') {
        mapping.value2homekit = {};
        mapping.value2homekit_re = [];
        if (mapping.homekit2name === undefined) {
          mapping.homekit2name = {};
        }
        for (const pair of mapping.values) {
          const match = pair.match('^([^:]*)(:(.*))?$');
          if (!match) {
            owner.log.error('values: format wrong for ' + pair);
            continue;
          }

          let from = match[1] as string;
          let to: HomekitValue = (match[3] === undefined ? pair : match[3]).replace(/\+/g, ' ');

          if (names?.[to] !== undefined) {
            mapping.homekit2name[names[to] as string] = to;
            to = names[to] as HomekitValue;
          } else if (names) {
            // a value given as its number gets its name for the log
            const name = nameOfValue(names, to);
            if (name !== undefined) {
              mapping.homekit2name[to] = name;
            }
          }

          const pattern = from.match('^/(.*)/$');
          if (pattern) {
            mapping.value2homekit_re.push({ re: pattern[1] as string, to: to });
          } else {
            from = from.replace(/\+/g, ' ');
            mapping.value2homekit[from] = to;
          }
        }
        if (mapping.value2homekit_re.length) {
          owner.log.debug('value2homekit_re: ' + util.inspect(mapping.value2homekit_re));
        }
        if (Object.keys(mapping.value2homekit).length) {
          owner.log.debug('value2homekit: ' + util.inspect(mapping.value2homekit));
        }
        if (Object.keys(mapping.homekit2name).length) {
          owner.log.debug('homekit2name: ' + util.inspect(mapping.homekit2name));
        } else {
          delete mapping.homekit2name;
        }
      }

      if (typeof mapping.valid === 'object') {
        owner.log.debug('valid: ' + util.inspect(mapping.valid));
        const valid: number[] = [];
        for (const value of mapping.valid) {
          // HomeKit takes numbers only: a name is replaced by its number
          const named = names?.[value];
          if (typeof named === 'number') {
            owner.log.debug('  ' + value + ' -> ' + named);
            valid.push(named);
            continue;
          }

          const number = toInt(value);
          if (isNaN(number)) {
            owner.log.error('valid: ' + value + ' is neither a number nor the name of a value of ' + characteristic_type);
            continue;
          }
          valid.push(number);
        }
        mapping.valid = valid.sort((a, b) => a - b);

        owner.log.debug('valid: ' + util.inspect(mapping.valid));
      }

      if (typeof mapping.cmds === 'object') {
        mapping.homekit2cmd = {};
        mapping.homekit2cmd_re = [];
        for (const pair of mapping.cmds) {
          const match = pair.match('^([^:]*)(:(.*))?$');
          if (!match) {
            owner.log.error('cmds: format wrong for ' + pair);
            continue;
          }

          let from = match[1] as string;
          const to = (match[2] !== undefined ? (match[3] as string) : from).replace(/\+/g, ' ');

          const pattern = from.match('^/(.*)/$');
          if (pattern) {
            mapping.homekit2cmd_re.push({ re: pattern[1] as string, to: to });
          } else {
            if (names?.[from] !== undefined) {
              from = names[from] as string;
            } else {
              from = from.replace(/\+/g, ' ');
            }

            mapping.homekit2cmd[from] = to;
          }
        }
        if (mapping.homekit2cmd_re.length) {
          owner.log.debug('homekit2cmd_re: ' + util.inspect(mapping.homekit2cmd_re));
        }
        if (Object.keys(mapping.homekit2cmd).length) {
          owner.log.debug('homekit2cmd: ' + util.inspect(mapping.homekit2cmd));
        }
      }

      const allowInline = environment.allowInlineFunctions !== false;
      resolveConverter(mapping, 'reading2homekit', owner.jsFunctions, owner.log, allowInline);
      resolveConverter(mapping, 'homekit2reading', owner.jsFunctions, owner.log, allowInline);

      const reading = mapping.reading as string;
      const own = device === owner.device;
      // the time of a reading of the device itself, as fhem lists it
      const time = own ? s.Readings[reading]?.Time : undefined;
      const listed = time ? toInt(new Date(time).getTime() / 1000) : undefined;
      let orig: unknown = undefined;
      if (!own) {
        // what the plugin has seen of the reading of the other device. fhem is asked all the same,
        // and what it answers is told like any change.
        orig = environment.cached[mapping.informId];
        if (orig !== undefined) {
          // fhem does not list when a reading of another device changed. when the plugin learned of
          // it is what it knows, and keeps across the accessories built anew.
          mapping.last_update = environment.changed[mapping.informId];
        }
        owner.query(mapping);
      } else if (s.Readings[reading]?.Value) {
        orig = s.Readings[reading].Value;
      }

      if (orig === undefined && own && mapping.default !== undefined) {
        delete mapping.informId;
      } else {
        const informId = mapping.informId;
        if (!isNocache(mapping) && mapping.reading && environment.cached[informId] === undefined) {
          environment.update(informId, orig);
          if (listed !== undefined) {
            environment.changed[informId] = listed;
          }
        }

        if (mapping.characteristic || mapping.name) {
          environment.reading2homekit(mapping, orig);
        }
      }

      if (listed !== undefined) {
        mapping.last_update = listed;
      }
    }
  }
}
