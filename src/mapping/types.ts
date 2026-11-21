// A mapping connects one HomeKit characteristic to a reading and a set command of a fhem device.
// The detection creates mappings for the device types it knows, and the homebridgeMapping
// attribute changes them or adds more.
//
// The types say what a property is meant to hold. A property that was read from an attribute is
// text at run time, also where a number is declared here, and the conversions rely on JavaScript
// turning such text into a number where it is used as one.
import type { Characteristic, WithUUID } from '@homebridge/hap-nodejs';
import type { Logging } from 'homebridge';

/** the value of a HomeKit characteristic */
export type HomekitValue = string | number | boolean;

/** converts between a reading and the value of a characteristic. the mapping is bound as its first argument. */
export type Converter = (value: never) => unknown;

export type CharacteristicClass = WithUUID<new () => Characteristic>;

export interface Mapping {
  // ---- what the detection or the homebridgeMapping attribute say

  /** the reading the value is taken from. `state` if neither a reading nor a default is given. */
  reading?: string;
  /** the fhem device the reading and the command belong to, if it is not the device of the accessory */
  device?: string;
  /** the set command the value is appended to */
  cmd?: string;
  /** set commands for the values 1 and 0 */
  cmdOn?: string;
  cmdOff?: string;
  /** text appended to every command */
  cmdSuffix?: string;
  commandSuffix?: string;

  /** the reading value that means on or off, or a regular expression between slashes */
  valueOn?: string;
  valueOff?: string;
  /** `from:to` pairs that translate reading values, `from` may be a regular expression between slashes */
  values?: string[];
  /** `from:to` pairs that translate values from HomeKit to set commands */
  cmds?: string[];
  /** the values HomeKit may offer for the characteristic */
  valid?: (string | number)[];
  /** the value used when the reading can not be converted. the name of a HomeKit value is replaced by its number. */
  default?: HomekitValue;

  /** wait this many milliseconds, or a second for `true`, and send only the last value */
  delay?: number | boolean;
  /** milliseconds after which the characteristic falls back to its default */
  timeout?: number;

  minValue?: number;
  maxValue?: number;
  minStep?: number;
  /** the largest value of the reading, scaled to `maxValue` */
  max?: number;
  factor?: number;
  invert?: unknown;
  /** readings above the threshold become 1, others 0 */
  threshold?: number;
  /** the word of the reading to use, counted from 0 */
  part?: number;
  /** never answer from the cache, always ask fhem. any value, also false or 0, says so: see isNocache */
  nocache?: unknown;
  readOnly?: unknown;

  /** distinguishes several services of the same type on one accessory */
  subtype?: string;
  /** name, format and unit of a characteristic that is given by its uuid */
  name?: string;
  format?: string;
  unit?: string;

  /** type and number of entries of the history */
  type?: string;
  size?: number | string;
  /** the serial number, for the SerialNumber mapping */
  serial?: string;
  value?: string;

  /** a function, its source between braces, or the name of a function from the jsFunctions file */
  reading2homekit?: Converter | string;
  homekit2reading?: Converter | string;

  // ---- set by the HMCCU detection for its converters

  levelFactor?: number;
  levelWriteFactor?: number;

  /** belongs to the accessory information and gets no characteristic of its own */
  _isInformation?: boolean;

  // ---- worked out when the accessory is created

  /** `<device>-<reading>`, the name events for the reading arrive under */
  informId?: string;
  /** the key the mapping is stored under: `[<service>[(<subtype>)]#]<characteristic or uuid>` */
  characteristic_type?: string;
  /** the class of the characteristic, replaced by the characteristic itself once the services exist */
  characteristic?: CharacteristicClass | Characteristic;
  log?: Logging;
  /** from the eventMap attribute of the device, for events that mean on or off */
  event_map?: Record<string, string>;
  value2homekit?: Record<string, HomekitValue>;
  value2homekit_re?: { re: string; to: HomekitValue }[];
  homekit2cmd?: Record<string, string>;
  homekit2cmd_re?: { re: string; to: string }[];
  /** names of the HomeKit values, for the log */
  homekit2name?: Record<string, string>;
  /** the value of the characteristic as last converted */
  cached?: HomekitValue;
  /** seconds since the epoch of the last change of the reading */
  last_update?: number;

  /** whatever else the homebridgeMapping attribute names */
  [parameter: string]: unknown;
}

/**
 * Puts text where a mapping declares a number, as it happens for values taken from the set
 * commands or the attributes of a device. See the note at the top of this file.
 */
export const numberAsText = (text: string | undefined): number => text as unknown as number;

/** a mapping of an accessory, which can log. every mapping is one once its accessory was created. */
export type PreparedMapping = Mapping & { log: Logging };

/** the mappings of an accessory by characteristic. a characteristic that is given several times holds a list. */
export type Mappings = Record<string, Mapping | Mapping[] | undefined>;

/** whether the mapping is not to be answered from the cache. nocache with any value says so. */
export function isNocache(mapping: object): boolean {
  return 'nocache' in mapping;
}
