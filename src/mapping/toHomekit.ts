// converts the value of a reading to the value of a HomeKit characteristic
import type { Characteristic } from '@homebridge/hap-nodejs';
import { looselyEqual, toFloat, toInt } from '../util/loose.ts';
import type { HomekitValue, PreparedMapping } from './types.ts';

/**
 * Converts a reading with the mapping, remembers the result as `mapping.cached` and returns it.
 * Uses the `reading2homekit` function of the mapping if it has one, and falls back to the default
 * of the mapping when the reading can not be converted. Returns undefined if there is no value.
 */
export function reading2homekit(mapping: PreparedMapping, reading: unknown): HomekitValue | undefined {
  let orig = reading;
  let value: unknown;
  if (typeof mapping.reading2homekit === 'function') {
    try {
      value = mapping.reading2homekit(orig as never);
    } catch (err) {
      mapping.log.error(mapping.informId + ' reading2homekit: ' + String(err));
      return undefined;
    }

    if (typeof value === 'number' && isNaN(value)) {
      mapping.log.error(mapping.informId + ' not a number: ' + String(orig));
      return undefined;
    }
  } else {
    value = convert(mapping, orig);
  }

  if (value === undefined) {
    if (mapping.default !== undefined) {
      orig = 'mapping.default';
      value = mapping.default;
    } else {
      return undefined;
    }
  }

  let defined: string | undefined = undefined;
  if (mapping.homekit2name !== undefined) {
    defined = mapping.homekit2name[value as string];
    if (defined === undefined) {
      defined = '???';
    }
  }

  mapping.log.info(
    '    caching: ' +
      (mapping.name ? mapping.name : mapping.characteristic_type) +
      ': ' +
      String(value) +
      ' (as ' +
      typeof value +
      (defined ? '; means ' + defined : '') +
      "; from '" +
      String(orig) +
      "')",
  );
  mapping.cached = value as HomekitValue;

  return value as HomekitValue;
}

// the value changes its type on the way: text from fhem, then a number, a boolean or the name of a
// HomeKit value, and parameters that were read from an attribute are text where numbers are
// expected. the arithmetic below is written as it was in homebridge-fhem and relies on JavaScript
// converting as it goes, so the value is left untyped inside this one function.
/* eslint-disable @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-unsafe-member-access,
   @typescript-eslint/no-unsafe-call, @typescript-eslint/no-unsafe-argument, @typescript-eslint/restrict-plus-operands */

/** the conversion for a mapping without a `reading2homekit` function. undefined if the reading is to be ignored. */
function convert(mapping: PreparedMapping, orig: unknown): unknown {
  let value: any = orig;
  if (value === undefined) {
    return undefined;
  }
  const reading = mapping.reading;
  if (reading === undefined) {
    return orig;
  }

  if (
    reading === 'temperature' ||
    reading === 'measured' ||
    reading === 'measured-temp' ||
    reading === 'desired-temp' ||
    reading === 'desired' ||
    reading === 'desiredTemperature'
  ) {
    if (typeof value === 'string' && value.toLowerCase() === 'on') {
      value = 31.0;
    } else if (typeof value === 'string' && value.toLowerCase() === 'off') {
      value = 4.0;
    } else {
      value = toFloat(value);
    }

    if (mapping.minValue !== undefined && value < mapping.minValue) {
      value = mapping.minValue;
    } else if (mapping.maxValue !== undefined && value > mapping.maxValue) {
      value = mapping.maxValue;
    }

    if (mapping.minStep) {
      if (mapping.minValue) {
        value -= mapping.minValue;
      }
      value = parseFloat((Math.round(value / mapping.minStep) * mapping.minStep).toFixed(1));
      if (mapping.minValue) {
        value += mapping.minValue;
      }
    }
  } else if (reading === 'humidity') {
    value = toInt(value);
  } else if (reading === 'onoff') {
    value = toInt(value);
  } else if (reading === 'reachable') {
    value = looselyEqual(toInt(value), true);
  } else if (
    reading === 'state' &&
    mapping.On &&
    typeof mapping.values !== 'object' &&
    mapping.reading2homekit === undefined &&
    mapping.valueOn === undefined &&
    mapping.valueOff === undefined
  ) {
    if (value.match(/^set-/)) {
      return undefined;
    }
    if (value.match(/^set_/)) {
      return undefined;
    }

    if (mapping.event_map !== undefined) {
      const mapped = mapping.event_map[value];
      if (mapped !== undefined) {
        value = mapped;
      }
    }

    if (value.toLowerCase() === 'off') {
      value = 0;
    } else if (looselyEqual(value, '000000')) {
      value = 0;
    } else if (value.match(/^[A-D]0$/)) {
      value = 0;
    } else {
      value = 1;
    }
  } else {
    if (value.match(/^set-/)) {
      return undefined;
    } else if (value.match(/^set_/)) {
      return undefined;
    }

    let format: any = undefined;
    if (typeof mapping.characteristic === 'object') {
      format = mapping.characteristic.props.format;
    } else if (typeof mapping.characteristic === 'function') {
      // a characteristic of the class, only to look at its format
      const characteristic = new (mapping.characteristic as unknown as new (value: unknown) => Characteristic)(orig);

      format = characteristic.props.format;
    } else if (mapping.format) {
      // only for testing !
      format = mapping.format;
    }

    if (mapping.event_map !== undefined) {
      const mapped = mapping.event_map[value];
      if (mapped !== undefined) {
        mapping.log.debug(mapping.informId + ' eventMap: value ' + value + ' mapped to: ' + mapped);
        value = mapped;
      }
    }

    if (value !== undefined && mapping.part !== undefined) {
      const mapped = value.split(' ')[mapping.part];

      if (mapped === undefined) {
        mapping.log.error(mapping.informId + ' value ' + value + ' has no part ' + mapping.part);
        return value;
      }
      mapping.log.debug(mapping.informId + ' parts: using part ' + mapping.part + ' of: ' + value + ' results in: ' + mapped);
      value = mapped;
    }

    if (mapping.threshold) {
      const mapped = parseFloat(value) > mapping.threshold ? 1 : 0;
      mapping.log.debug(mapping.informId + ' threshold: value ' + value + ' mapped to ' + mapped);
      value = mapped;
    }

    if (typeof mapping.value2homekit_re === 'object' || typeof mapping.value2homekit === 'object') {
      let mapped: any = undefined;
      if (typeof mapping.value2homekit_re === 'object') {
        for (const entry of mapping.value2homekit_re) {
          if (value && value.match(entry.re)) {
            mapped = entry.to;
            break;
          }
        }
      }

      if (mapped === '#') {
        mapped = value;
      }

      if (typeof mapping.value2homekit === 'object') {
        if (mapping.value2homekit[value] !== undefined) {
          mapped = mapping.value2homekit[value];
        }
      }

      if (mapped === undefined) {
        mapped = mapping.default;
      }

      if (mapped === undefined) {
        // logged for every event that carries such a value. see docs/KNOWN_BUGS.md, 5.
        mapping.log.error(mapping.informId + ' value ' + value + ' not handled in values');
        return undefined;
      }

      mapping.log.debug(mapping.informId + ' values: value ' + value + ' mapped to ' + mapped);
      value = mapped;
    }

    if (format === undefined) {
      return value;
    }

    if (!format) {
      mapping.log.error(mapping.informId + ' empty format');
    } else if (format.match(/bool/i)) {
      let mapped: any = undefined;
      if (mapping.valueOn !== undefined) {
        const match = mapping.valueOn.match('^/(.*)/$');
        if (!match && looselyEqual(value, mapping.valueOn)) {
          mapped = 1;
        } else if (match && value.toString().match(match[1])) {
          mapped = 1;
        } else {
          mapped = 0;
        }
      }
      if (mapping.valueOff !== undefined) {
        const match = mapping.valueOff.match('^/(.*)/$');
        if (!match && looselyEqual(value, mapping.valueOff)) {
          mapped = 0;
        } else if (match && value.toString().match(match[1])) {
          mapped = 0;
        } else if (mapped === undefined) {
          mapped = 1;
        }
      }
      if (mapping.valueOn === undefined && mapping.valueOff === undefined) {
        if (typeof value === 'string' && value.toLowerCase() === 'on') {
          mapped = 1;
        } else if (typeof value === 'string' && value.toLowerCase() === 'off') {
          mapped = 0;
        } else {
          mapped = toInt(value) ? 1 : 0;
        }
      }
      if (mapped !== undefined) {
        mapping.log.debug(mapping.informId + ' valueOn/valueOff: value ' + value + ' mapped to ' + mapped);
        value = mapped;
      }

      if (mapping.factor) {
        mapping.log.debug(mapping.informId + ' factor: value ' + value + ' mapped to ' + value * mapping.factor);
        value *= mapping.factor;
      }

      if (mapping.invert) {
        mapping.minValue = 0;
        mapping.maxValue = 1;
      }
    } else if (format.match(/float/i)) {
      value = toFloat(value);

      if (mapping.factor) {
        mapping.log.debug(mapping.informId + ' factor: value ' + value + ' mapped to ' + value * mapping.factor);
        value *= mapping.factor;
      }
    } else if (format.match(/int/i)) {
      value = toFloat(value);

      if (mapping.factor) {
        mapping.log.debug(mapping.informId + ' factor: value ' + value + ' mapped to ' + value * mapping.factor);
        value *= mapping.factor;
      }

      value = toInt(value + 0.5);
    }

    if (mapping.max && mapping.maxValue) {
      value = Math.round((value * mapping.maxValue) / mapping.max);
      mapping.log.debug(mapping.informId + ' value ' + orig + ' scaled to: ' + value);
    }

    if (mapping.minValue !== undefined && value < mapping.minValue) {
      mapping.log.debug(mapping.informId + ' value ' + value + ' clipped to minValue: ' + mapping.minValue);
      value = mapping.minValue;
    } else if (mapping.maxValue !== undefined && value > mapping.maxValue) {
      mapping.log.debug(mapping.informId + ' value ' + value + ' clipped to maxValue: ' + mapping.maxValue);
      value = mapping.maxValue;
    }

    if (mapping.minStep) {
      if (mapping.minValue) {
        value -= mapping.minValue;
      }
      value = parseFloat((Math.round(value / mapping.minStep) * mapping.minStep).toFixed(1));
      if (mapping.minValue) {
        value += mapping.minValue;
      }
    }

    if (format && format.match(/int/i)) {
      value = toInt(value);
    } else if (format && format.match(/float/i)) {
      value = toFloat(value);
    }

    if (typeof value === 'number') {
      let mapped = value;
      if (isNaN(value)) {
        mapping.log.error(mapping.informId + ' not a number: ' + orig);
        return undefined;
      } else if (mapping.invert && mapping.minValue !== undefined && mapping.maxValue !== undefined) {
        mapped = mapping.maxValue - value + mapping.minValue;
      } else if (mapping.invert && mapping.maxValue !== undefined) {
        mapped = mapping.maxValue - value;
      } else if (mapping.invert) {
        mapped = 100 - value;
      }

      if (value !== mapped) {
        mapping.log.debug(mapping.informId + ' value: ' + value + ' inverted to ' + mapped);
      }
      value = mapped;
    }

    if (format && format.match(/bool/i)) {
      value = Boolean(toInt(value));
    }
  }

  return value;
}
