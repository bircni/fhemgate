import { describe, expect, it } from 'vitest';
import { createLog } from '../../test/support/log.ts';
import { commandFor, type CommandSource } from './toFhem.ts';
import type { Mapping, PreparedMapping } from './types.ts';

function source(): CommandSource {
  return { name: 'acc', type: 'dummy', device: 'dev', mappings: {}, log: createLog() as unknown as CommandSource['log'] };
}

const prepared = (mapping: Mapping) => ({ device: 'dev', characteristic_type: 'X', ...mapping, log: createLog() }) as unknown as PreparedMapping;

describe('commandFor', () => {
  it('appends the value to the command of the mapping', () => {
    expect(commandFor(source(), prepared({ cmd: 'pct' }), 40)).toBe('set dev pct 40');
  });

  it('inverts, divides by the factor and scales to the range of the device, in this order', () => {
    const mapping = prepared({ cmd: 'bri', invert: true, minValue: 0, maxValue: 100, factor: 0.5, max: 254 });

    // 100 - 25 = 75, 75 / 0.5 = 150, 150 * 254 / 100
    expect(commandFor(source(), mapping, 25)).toBe('set dev bri 381');
  });

  it('prefers cmdOn and cmdOff, then the cmds table, then its patterns', () => {
    const mapping = prepared({ cmd: 'x', cmdOn: 'an', cmdOff: 'aus', homekit2cmd: { 2: 'zwei' }, homekit2cmd_re: [{ re: '^3', to: 'drei' }] });

    expect(commandFor(source(), mapping, true)).toBe('set dev an');
    expect(commandFor(source(), mapping, 0)).toBe('set dev aus');
    expect(commandFor(source(), mapping, 2)).toBe('set dev zwei');
    expect(commandFor(source(), mapping, 35)).toBe('set dev drei');
    expect(commandFor(source(), mapping, 4)).toBe('set dev x 4');
  });

  it('sends to the device of the mapping and appends its suffix', () => {
    expect(commandFor(source(), prepared({ device: 'other', cmd: 'x', cmdSuffix: '5', commandSuffix: '6' }), 1)).toBe('set other x 1 5');
    expect(commandFor(source(), prepared({ cmd: 'x', commandSuffix: '6' }), 1)).toBe('set dev x 1 6');
  });

  it('sends nothing for a readOnly mapping', () => {
    const from = source();

    expect(commandFor(from, prepared({ cmd: 'x', readOnly: '1' }), 1)).toBeUndefined();
    expect((from.log as unknown as ReturnType<typeof createLog>).lines).toEqual(['info acc NOT sending command x with value 1 for readOnly characteristic']);
  });
});
