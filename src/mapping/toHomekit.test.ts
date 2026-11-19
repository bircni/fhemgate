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
      reading: 'r', format: 'float', part: 1, value2homekit: { low: '10' }, value2homekit_re: [],
      factor: 2, minValue: 0, maxValue: 30, minStep: 5, invert: true,
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
    expect(log.lines).toEqual(['error d-r value high not handled in values']);
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

  it('fails for a value that is not text', () => {
    expect(() => reading2homekit(prepared({ reading: 'r', format: 'int' }).mapping, 5)).toThrow(TypeError);
  });

  it('fails for a mapping that can not log', () => {
    expect(() => reading2homekit({ reading: 'r' } as PreparedMapping, 'x')).toThrow(TypeError);
  });
});
