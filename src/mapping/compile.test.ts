import { describe, expect, it, vi } from 'vitest';
import * as hap from '@homebridge/hap-nodejs';
import { createLog } from '../../test/support/log.ts';
import type { Jsonlist2Device } from '../devices/types.ts';
import { toInt } from '../util/loose.ts';
import { prepareMappings, type MappingOwner, type PrepareEnvironment } from './compile.ts';
import type { CharacteristicClass, Mapping, Mappings } from './types.ts';

function prepare(
  mappings: Mappings,
  device: Partial<Jsonlist2Device> = {},
  known: Pick<PrepareEnvironment, 'cached' | 'changed'> = { cached: {}, changed: {} },
) {
  const log = createLog();
  const characteristics = hap.Characteristic as unknown as Record<string, unknown>;
  const owner: MappingOwner = {
    device: 'dev',
    log: log as unknown as MappingOwner['log'],
    mappings,
    query: vi.fn(),
    characteristicOfName: (name) => characteristics[name.split('#').pop() ?? ''] as CharacteristicClass | undefined,
  };
  const environment: PrepareEnvironment = {
    characteristics,
    ...known,
    update: vi.fn((informId: string, value: unknown) => {
      if (value !== undefined) {
        known.cached[informId] = value;
      }
    }),
    reading2homekit: vi.fn(),
  };
  const s: Jsonlist2Device = { Internals: { NAME: 'dev', TYPE: 'dummy' }, Readings: {}, Attributes: {}, PossibleSets: '', PossibleAttrs: '', ...device };

  prepareMappings(owner, s, environment);
  return { owner, environment, log: log.lines };
}

describe('prepareMappings', () => {
  it('gives every mapping its device, the reading state, the id of its events and its characteristic', () => {
    const mapping: Mapping = {};

    prepare({ On: mapping });

    expect(mapping).toMatchObject({ device: 'dev', reading: 'state', informId: 'dev-state', characteristic_type: 'On' });
    expect(mapping.characteristic).toBe(hap.Characteristic.On);
  });

  it('keeps the service in the type of the first mapping of a list only', () => {
    const first: Mapping = { reading: 'a' };
    const second: Mapping = { reading: 'b' };

    prepare({ 'Outlet#On': [first, second] });

    expect(first.characteristic_type).toBe('Outlet#On');
    expect(second.characteristic_type).toBe('On');
  });

  it('builds the tables for values and commands with the numbers of the HomeKit names', () => {
    const mapping: Mapping = { values: ['auf:OPEN', '/zu/:CLOSED', 'halb:7'], cmds: ['OPEN:auf', '/1|4/:zu', 'x+y:a+b'] };

    prepare({ CurrentDoorState: mapping });

    expect(mapping.value2homekit).toEqual({ auf: 0, halb: '7' });
    expect(mapping.value2homekit_re).toEqual([{ re: 'zu', to: 1 }]);
    expect(mapping.homekit2name).toEqual({ 0: 'OPEN', 1: 'CLOSED' });
    expect(mapping.homekit2cmd).toEqual({ 0: 'auf', 'x y': 'a b' });
    expect(mapping.homekit2cmd_re).toEqual([{ re: '1|4', to: 'zu' }]);
  });

  it('names a value that is given as its number, and nothing the class only inherits', () => {
    const mapping: Mapping = { values: ['zu:0', 'auf:1', 'halb:7', 'leer:'] };

    prepare({ CurrentHeatingCoolingState: mapping });

    expect(mapping.homekit2name).toEqual({ 0: 'OFF', 1: 'HEAT' });
  });

  it('replaces the names in a list of valid values by their numbers and keeps the numbers', () => {
    const mapping: Mapping = { valid: ['OFF', 'HEAT', '3'] };

    prepare({ TargetHeatingCoolingState: mapping });

    expect(mapping.valid).toEqual([0, 1, 3]);
  });

  it('leaves out a valid value that is neither a name nor a number, and sorts the others as numbers', () => {
    const mapping: Mapping = { valid: ['10', 'x', '9', 'ARMED'] };

    const { log } = prepare({ SecuritySystemTargetState: mapping });

    expect(mapping.valid).toEqual([9, 10]);
    expect(log).toEqual([
      'error valid: x is neither a number nor the name of a value of SecuritySystemTargetState',
      'error valid: ARMED is neither a number nor the name of a value of SecuritySystemTargetState',
    ]);
  });

  it('takes the first value from the reading of the device and notes when it last changed', () => {
    const mapping: Mapping = { reading: 'level' };

    const { environment } = prepare({ Brightness: mapping }, { Readings: { level: { Value: '40', Time: '2026-08-16 12:00:00' } } });

    expect(environment.update).toHaveBeenCalledWith('dev-level', '40');
    expect(environment.reading2homekit).toHaveBeenCalledWith(mapping, '40');
    expect(mapping.last_update).toBe(1786881600);
  });

  it('asks fhem for the reading of another device', () => {
    const mapping: Mapping = { device: 'other', reading: 'level' };

    const { owner } = prepare({ Brightness: mapping });

    expect(owner.query).toHaveBeenCalledWith(mapping);
    expect(mapping.informId).toBe('other-level');
  });

  it('takes when a reading of another device changed from what the plugin learned, as fhem does not list it', () => {
    const mapping: Mapping = { device: 'other', reading: 'state' };
    const uncached: Mapping = { device: 'other', reading: 'state', nocache: true };
    const unseen: Mapping = { device: 'other', reading: 'level' };

    prepare(
      { ContactSensorState: mapping, On: uncached, Brightness: unseen },
      { Readings: { state: { Value: 'closed', Time: '2026-01-01 00:00:00' } } },
      { cached: { 'other-state': 'open' }, changed: { 'other-state': 1234 } },
    );

    // not the time of the reading of the same name of the device itself. nocache says how a read
    // is answered, not what the plugin knows.
    expect(mapping.last_update).toBe(1234);
    expect(uncached.last_update).toBe(1234);
    expect(unseen.last_update).toBeUndefined();
  });

  it('keeps the time fhem lists also when the value was cached before, from another device that follows the reading', () => {
    const known = { cached: { 'dev-state': 'on' } as Record<string, unknown>, changed: { 'dev-state': 99 } as Record<string, number> };

    prepare({ On: {} }, { Readings: { state: { Value: 'on', Time: '2026-01-01 00:00:00' } } }, known);

    expect(known.changed['dev-state']).toBe(toInt(new Date('2026-01-01 00:00:00').getTime() / 1000));
  });

  it('takes no time fhem lists that is none', () => {
    const mapping: Mapping = {};
    const { environment } = prepare({ On: mapping }, { Readings: { state: { Value: 'on', Time: 'soon' } } });

    expect(environment.changed['dev-state']).toBeUndefined();
    expect(mapping.last_update).toBeUndefined();
  });

  it('keeps the time fhem lists for a reading of the device itself in the cache', () => {
    const { environment } = prepare({ On: {} }, { Readings: { state: { Value: 'on', Time: '2026-01-01 00:00:00' } } });

    expect(environment.changed['dev-state']).toBe(toInt(new Date('2026-01-01 00:00:00').getTime() / 1000));
  });

  it('gives a mapping with only a default no id for events', () => {
    const mapping: Mapping = { default: 'CLOSED' };

    const { environment } = prepare({ TargetDoorState: mapping });

    expect(mapping.default).toBe(1);
    expect(mapping).not.toHaveProperty('informId');
    expect(environment.reading2homekit).not.toHaveBeenCalled();
  });

  it('collects the events that mean on or off from the eventMap attribute', () => {
    const mapping: Mapping = {};

    prepare({ On: mapping }, { Attributes: { eventMap: 'BI:on B0:off B1:toggle' } });

    expect(mapping.event_map).toEqual({ BI: 'on', B0: 'off' });
  });
});
