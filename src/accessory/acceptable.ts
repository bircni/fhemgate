// HomeKit shows an accessory as not responding when one of its characteristics holds a value
// that does not fit its format, its range or its list of valid values, and HAP-NodeJS warns
// about every such value. readings and mappings come from fhem and can say anything, so every
// value passes through here before HomeKit gets it.
import type { Characteristic } from '@homebridge/hap-nodejs';
import type { HomekitValue } from '../mapping/types.ts';

// the numbers each numeric format of HomeKit can hold
const formatRange: Record<string, [number, number] | undefined> = {
  int: [-2147483648, 2147483647],
  float: [-Number.MAX_VALUE, Number.MAX_VALUE],
  uint8: [0, 255],
  uint16: [0, 65535],
  uint32: [0, 4294967295],
  uint64: [0, Number.MAX_SAFE_INTEGER],
};

/** the longest text HomeKit takes for a characteristic that does not say otherwise */
const defaultMaxLength = 64;

/**
 * The value as the characteristic accepts it: unchanged if it fits, otherwise brought into the
 * range, cut to the allowed length, or replaced by a valid value the way HAP-NodeJS would. Undefined
 * for a value that can not be made to fit, like text where a number is expected: the characteristic
 * then keeps the value it has.
 */
export function acceptableValue(characteristic: Characteristic, value: unknown): HomekitValue | undefined {
  const props = characteristic.props;
  const range = formatRange[props.format];

  if (props.format === 'bool') {
    // HAP-NodeJS takes 1 and '1' and 'true' for true and every other number or text for false
    return typeof value === 'boolean' || typeof value === 'number' || typeof value === 'string' ? value : undefined;
  }

  if (props.format === 'string') {
    if (typeof value !== 'string' && typeof value !== 'number' && typeof value !== 'boolean') {
      return undefined;
    }
    const text = String(value);
    const maxLength = props.maxLen ?? defaultMaxLength;
    return text.length > maxLength ? text.substring(0, maxLength) : text;
  }

  if (!range) {
    // data and tlv8 are handed on as they are
    return value as HomekitValue | undefined;
  }

  let number: unknown = value;
  if (typeof value === 'boolean') {
    number = value ? 1 : 0;
  } else if (typeof value === 'string') {
    number = props.format === 'float' ? Number.parseFloat(value) : Number.parseInt(value, 10);
  }
  if (typeof number !== 'number' || !Number.isFinite(number)) {
    return undefined;
  }

  const min = Math.max(props.minValue ?? range[0], range[0]);
  const max = Math.min(props.maxValue ?? range[1], range[1]);
  let fitted = Math.min(Math.max(number, min), max);

  const [lowest, highest] = props.validValueRanges ?? [];
  if (lowest !== undefined && highest !== undefined) {
    fitted = Math.min(Math.max(fitted, lowest), highest);
  }

  const valid = props.validValues;
  if (valid && !valid.includes(fitted)) {
    // what HAP-NodeJS does with such a value, without the warning
    const current = characteristic.value;
    return typeof current === 'number' && valid.includes(current) ? current : valid[0];
  }

  // a value that fits is handed on as it came, also as text or as a boolean
  return fitted === number ? (value as HomekitValue) : fitted;
}
