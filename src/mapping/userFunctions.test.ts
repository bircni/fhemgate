import { describe, expect, it } from 'vitest';
import { createLog } from '../../test/support/log.ts';
import type { Mapping } from './types.ts';
import { resolveConverter } from './userFunctions.ts';

function resolve(mapping: Mapping, parameter: 'reading2homekit' | 'homekit2reading', jsFunctions?: unknown) {
  const log = createLog();
  resolveConverter(mapping, parameter, jsFunctions, log as unknown as Parameters<typeof resolveConverter>[3]);
  return log.lines;
}

describe('resolveConverter', () => {
  it('builds a function from source between braces, which gets the mapping and the value', () => {
    const mapping: Mapping = { factor: 3, reading2homekit: '{return orig * mapping.factor}' };

    expect(resolve(mapping, 'reading2homekit')).toEqual([]);
    expect((mapping.reading2homekit as (value: number) => unknown)(2)).toBe(6);
  });

  it('takes a function of the jsFunctions file by name', () => {
    const mapping: Mapping = { factor: 3, homekit2reading: 'triple' };

    resolve(mapping, 'homekit2reading', { triple: (m: Mapping, value: number) => value * (m.factor ?? 1) });

    expect((mapping.homekit2reading as (value: number) => unknown)(2)).toBe(6);
  });

  it('leaves a function alone', () => {
    const converter = () => 1;
    const mapping: Mapping = { reading2homekit: converter };

    resolve(mapping, 'reading2homekit');

    expect(mapping.reading2homekit).toBe(converter);
  });

  it('removes reading2homekit when a name can not be resolved without a jsFunctions file', () => {
    const mapping: Mapping = { reading2homekit: 'name' };

    expect(resolve(mapping, 'reading2homekit')).toEqual(['error   reading2homekit disabled.']);
    expect(mapping).toEqual({});
  });

  it('removes homekit2reading when it can not be resolved, and leaves reading2homekit alone', () => {
    const read = () => 1;
    const mapping: Mapping = { reading2homekit: read, homekit2reading: 'name' };

    expect(resolve(mapping, 'homekit2reading', {})).toEqual(['error   homekit2reading: no function named name in {}', 'error   homekit2reading disabled.']);
    expect(mapping).toEqual({ reading2homekit: read });
  });

  it('removes source that does not compile', () => {
    const mapping: Mapping = { homekit2reading: '{return (}' };

    expect(resolve(mapping, 'homekit2reading').at(-1)).toBe('error   homekit2reading disabled.');
    expect(mapping).toEqual({});
  });
});
