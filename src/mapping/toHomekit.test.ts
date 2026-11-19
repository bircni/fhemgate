import { describe, expect, it } from 'vitest';
import { createLog } from '../../test/support/log.ts';
import { reading2homekit } from './toHomekit.ts';
import type { Mapping, PreparedMapping } from './types.ts';

function prepared(mapping: Mapping) {
  const log = createLog();
  return { mapping: { informId: 'd-r', ...mapping, log } as unknown as PreparedMapping, log };
}

describe('reading2homekit', () => {
  it('applies part, values, factor, limits, steps and invert in this order', () => {
    const { mapping } = prepared({
      reading: 'r',
      format: 'float',
      part: 1,
      value2homekit: { low: '10' },
      value2homekit_re: [],
      factor: 2,
      minValue: 0,
      maxValue: 30,
      minStep: 5,
      invert: true,
    });

    // 'low' -> '10' -> 20 -> within 0..30 -> a multiple of 5 -> 30 - 20 + 0
    expect(reading2homekit(mapping, 'x low')).toBe(10);
  });

  it('clips to the limits before it inverts', () => {
    const { mapping } = prepared({ reading: 'r', format: 'float', factor: 2, minValue: 0, maxValue: 30, invert: true });

    // 17 -> 34 -> clipped to 30 -> 30 - 30 + 0
    expect(reading2homekit(mapping, '17')).toBe(0);
  });

  it('has no value for a reading that is not in the values of the mapping', () => {
    const { mapping, log } = prepared({ reading: 'r', format: 'float', value2homekit: { low: '10' }, value2homekit_re: [] });

    expect(reading2homekit(mapping, 'high')).toBeUndefined();
    expect(log.lines).toEqual(['warn d-r value high not handled in values']);
  });

  it('warns about a value that is not in the values of the mapping once, however often it arrives', () => {
    const { mapping, log } = prepared({ reading: 'r', format: 'float', value2homekit: { low: '10' }, value2homekit_re: [] });
    const other = prepared({ reading: 'r', format: 'float', value2homekit: { low: '10' }, value2homekit_re: [] });

    for (const value of ['high', 'low', 'high', 'higher', 'high']) {
      reading2homekit(mapping, value);
    }
    reading2homekit(other.mapping, 'high');

    expect(log.lines.filter((line) => !line.startsWith('info '))).toEqual([
      'warn d-r value high not handled in values',
      'warn d-r value higher not handled in values',
    ]);
    expect(other.log.lines).toEqual(['warn d-r value high not handled in values']);
  });

  it('remembers the converted value at the mapping', () => {
    const { mapping, log } = prepared({ reading: 'r', format: 'int', characteristic_type: 'Brightness' });

    expect(reading2homekit(mapping, '41.6')).toBe(42);
    expect(mapping.cached).toBe(42);
    expect(log.lines).toEqual(["info     caching: Brightness: 42 (as number; from '41.6')"]);
  });

  it('answers the reading as it is for a mapping without format', () => {
    expect(reading2homekit(prepared({ reading: 'r' }).mapping, 'text')).toBe('text');
  });

  it('ignores readings that only say what was set', () => {
    const { mapping } = prepared({ reading: 'r', format: 'bool', default: 7 });

    expect(reading2homekit(mapping, 'set-on')).toBe(7);
    expect(reading2homekit(prepared({ reading: 'r', format: 'bool' }).mapping, 'set_on')).toBeUndefined();
  });

  it('falls back to the default when the function of the mapping answers nothing', () => {
    const { mapping, log } = prepared({ reading2homekit: () => undefined, default: 3, name: 'Custom' });

    expect(reading2homekit(mapping, 'x')).toBe(3);
    expect(log.lines).toEqual(["info     caching: Custom: 3 (as number; from 'mapping.default')"]);
  });

  it('converts a value that is not text like the text for it', () => {
    expect(reading2homekit(prepared({ reading: 'r', format: 'int' }).mapping, 5)).toBe(5);
    expect(reading2homekit(prepared({ reading: 'r', format: 'bool' }).mapping, 1)).toBe(true);
    expect(reading2homekit(prepared({ reading: 'r', format: 'bool' }).mapping, false)).toBe(false);
    expect(reading2homekit(prepared({ reading: 'state', On: true }).mapping, 0)).toBe(1);
    expect(reading2homekit(prepared({ reading: 'r', format: 'int', value2homekit: { 1: 3 }, value2homekit_re: [] }).mapping, 1)).toBe(3);
  });

  it('has no value for a reading that is null', () => {
    expect(reading2homekit(prepared({ reading: 'r', format: 'int' }).mapping, null)).toBeUndefined();
  });

  it('fails for a mapping that can not log', () => {
    expect(() => reading2homekit({ reading: 'r' } as PreparedMapping, 'x')).toThrow(TypeError);
  });
});
