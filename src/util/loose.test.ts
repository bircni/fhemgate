import { expect, it } from 'vitest';
import { looselyEqual, toFloat, toInt } from './loose.ts';

it('compares the way == does', () => {
  expect(looselyEqual(1, true)).toBe(true);
  expect(looselyEqual('1', 1)).toBe(true);
  expect(looselyEqual(0, false)).toBe(true);
  expect(looselyEqual(0, '')).toBe(true);
  expect(looselyEqual(null, undefined)).toBe(true);
  expect(looselyEqual('on', true)).toBe(false);
  expect(looselyEqual(2, true)).toBe(false);
});

it('parses numbers out of whatever a value looks like as text', () => {
  expect(toInt(21.7)).toBe(21);
  expect(toInt('21.7 C')).toBe(21);
  expect(toInt(true)).toBeNaN();
  expect(toInt(1e21)).toBe(1);
  expect(toFloat('21.7 C')).toBe(21.7);
  expect(toFloat(3)).toBe(3);
  expect(toFloat(undefined)).toBeNaN();
});
