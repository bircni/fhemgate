import { describe, expect, it } from 'vitest';
import { createLog } from '../../test/support/log.ts';
import { parseHomebridgeMapping, type MappingTarget } from './parser.ts';
import type { Mappings } from './types.ts';

function parse(homebridgeMapping: string, mappings: Mappings = {}, categories?: Record<string, number>) {
  const log = createLog();
  const target: MappingTarget = { mappings, log: log as unknown as MappingTarget['log'] };
  parseHomebridgeMapping(target, homebridgeMapping, categories);
  return { target, log: log.lines.slice(1) };
}

describe('parseHomebridgeMapping', () => {
  it('reads entries into the mappings of the target', () => {
    const { target } = parse('On=state,cmdOn=an Brightness=cmd:dev:pct,delay=250');

    expect(target.mappings).toEqual({
      On: { reading: 'state', cmdOn: 'an' },
      Brightness: { cmd: 'cmd', device: 'dev', reading: 'pct', delay: 250 },
    });
  });

  it('sets the category when it is given the categories of HomeKit', () => {
    const { target, log } = parse('AccessoryCategory=FAN On=state', {}, { FAN: 3 });

    expect(target.category).toBe(3);
    expect(target.mappings).toEqual({ On: { reading: 'state' } });
    expect(log).toEqual(['info using category: 3 (FAN)']);
  });

  it('reports a category it does not know', () => {
    const { target, log } = parse('AccessoryCategory=NOPE', {}, { FAN: 3 });

    expect(target.category).toBeUndefined();
    expect(log).toEqual(['error unknown category: NOPE']);
  });

  it('changes a list of mappings as if it was one mapping', () => {
    const list = [{ reading: 'a' }, { reading: 'b' }];

    const { target } = parse('On=cmdOn=an', { On: list });

    expect(target.mappings.On).toBe(list);
    expect((list as unknown as { cmdOn: string }).cmdOn).toBe('an');
  });

  it('looks for a characteristic to copy in the current service, even before there is one', () => {
    const { target } = parse('A=B', { 'undefined#B': { reading: 'b' } });

    expect(target.mappings.A).toEqual({ reading: 'b' });
  });

  it('replaces the mappings with a JSON object', () => {
    const { target } = parse('{"On":{"reading":"x"}}', { Hue: { reading: 'hue' } });

    expect(target.mappings).toEqual({ On: { reading: 'x' } });
  });
});
