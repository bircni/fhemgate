// values that come from fhem attributes and readings are text, values from homekit are numbers
// and booleans, and the code taken over from homebridge-fhem compares and converts them the way
// JavaScript does when it is left to it. these helpers keep that conversion in one visible place.

/** `a == b` as JavaScript defines it: `1 == true` and `'1' == 1` hold */
export function looselyEqual(a: unknown, b: unknown): boolean {
  // eslint-disable-next-line eqeqeq -- the conversion is the point
  return a == b;
}

/** parseInt of whatever the value looks like as text, as `parseInt(value)` does for a value that is not a string */
export function toInt(value: unknown): number {
  return parseInt(value as string);
}

/** parseFloat of whatever the value looks like as text */
export function toFloat(value: unknown): number {
  return parseFloat(value as string);
}
