// turns a value HomeKit wrote to a characteristic into the fhem command to send
import type { Logging } from 'homebridge';
import { looselyEqual } from '../util/loose.ts';
import type { Mappings, PreparedMapping } from './types.ts';

/** what the command depends on besides the mapping */
export interface CommandSource {
  /** the name of the accessory, for the log */
  name?: string;
  /** the type of the fhem device */
  type?: string;
  /** the name of the fhem device */
  device?: string;
  mappings: Mappings;
  log: Logging;
  /** the commands that are waiting to be sent */
  delayed_timers?: Record<string, unknown>;
}

// see the note in toHomekit.ts: the value changes its type on the way and the parameters of a
// mapping may be text where numbers are expected. the arithmetic is kept as it was.
/* eslint-disable @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-unsafe-member-access,
   @typescript-eslint/no-unsafe-call,
   @typescript-eslint/restrict-plus-operands */

/**
 * The fhem command for a value of the characteristic of the mapping, or undefined if nothing is
 * to be sent. Instead of a mapping the name of one of three commands can be given: `identify`,
 * `xhue` and `xsat`.
 */
export function commandFor(source: CommandSource, target: PreparedMapping | string, valueFromHomekit?: unknown): string | undefined {
  const mapping = target as PreparedMapping;
  let value: any = valueFromHomekit;

  if (mapping.readOnly) {
    // the command is not known yet at this point and a blank is missing.
    source.log.info(source.name + ' NOT sending command ' + undefined + ' with value ' + value + 'for readOnly characteristic');
    return undefined;
  }

  let c: any = target;
  if (typeof target === 'object') {
    c = target.cmd;
  } else {
    source.log.info(source.name + ' sending command ' + c + ' with value ' + value);
  }

  let command: string;
  if (c === 'identify') {
    if (source.type === 'HUEDevice') {
      // the blank after the device is missing.
      command = 'set ' + source.device + 'alert select';
    } else {
      command = 'set ' + source.device + ' toggle; sleep 1; set ' + source.device + ' toggle';
    }
  } else if (c === 'xhue') {
    const hue = source.mappings.Hue as any;
    value = Math.round((value * hue.max) / hue.maxValue);
    command = 'set ' + hue.device + ' hue ' + value;
  } else if (c === 'xsat') {
    const saturation = source.mappings.Saturation as any;
    value = (value / 100) * saturation.max;
    command = 'set ' + saturation.device + ' sat ' + value;
  } else {
    if (mapping.characteristic_type === 'On' && value) {
      // meant to skip switching on while a delayed command is waiting, but the timers are kept
      // in an object, which has no length.
      if (source.delayed_timers?.length) {
        mapping.log.info(source.name + ': skipping set cmd for ' + mapping.characteristic_type + ' with value ' + value);
        return undefined;
      }
    }

    mapping.log.info(source.name + ': executing set cmd for ' + mapping.characteristic_type + ' with value ' + value);

    if (typeof mapping.homekit2reading === 'function') {
      try {
        value = mapping.homekit2reading(value as never);
      } catch (err) {
        mapping.log.error(mapping.informId + ' homekit2reading: ' + err);
        return undefined;
      }
      if (value === undefined) {
        mapping.log.info('  converted value is unchanged ');
        return undefined;
      }

      mapping.log.info('  value converted to ' + value);
    } else {
      if (typeof value === 'number') {
        let mapped = value;
        if (mapping.invert && mapping.minValue !== undefined && mapping.maxValue !== undefined) {
          mapped = mapping.maxValue - value + mapping.minValue;
        } else if (mapping.invert && mapping.maxValue !== undefined) {
          mapped = mapping.maxValue - value;
        } else if (mapping.invert) {
          mapped = 100 - value;
        }

        if (value !== mapped) {
          mapping.log.debug('  value: ' + value + ' inverted to ' + mapped);
          value = mapped;
        }

        if (mapping.factor) {
          mapped /= mapping.factor;
          mapping.log.debug('  value: ' + value + ' mapped to ' + mapped);
          value = mapped;
        }

        if (mapping.max !== undefined && mapping.maxValue != null) {
          value = Math.round((value * mapping.max) / mapping.maxValue);
        }
      }
    }

    let cmd: string = mapping.cmd + ' ' + value;

    if (mapping.cmdOn !== undefined && looselyEqual(value, 1)) {
      cmd = mapping.cmdOn;
    } else if (mapping.cmdOff !== undefined && looselyEqual(value, 0)) {
      cmd = mapping.cmdOff;
    } else if (typeof mapping.homekit2cmd === 'object' && mapping.homekit2cmd[value] !== undefined) {
      cmd = mapping.homekit2cmd[value] as string;
    } else if (typeof mapping.homekit2cmd_re === 'object') {
      for (const entry of mapping.homekit2cmd_re) {
        if (value.toString().match(entry.re)) {
          cmd = entry.to;
          break;
        }
      }
    }

    command = 'set ' + mapping.device + ' ' + cmd;
  }

  if (mapping.cmdSuffix !== undefined) {
    command += ' ' + mapping.cmdSuffix;
  } else if (mapping.commandSuffix !== undefined) {
    command += ' ' + mapping.commandSuffix;
  }

  return command;
}
