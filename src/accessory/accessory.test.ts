import * as hap from '@homebridge/hap-nodejs';
import { describe, expect, it, vi } from 'vitest';
import { createLog } from '../../test/support/log.ts';
import type { Jsonlist2Device } from '../devices/types.ts';
import type { PreparedMapping } from '../mapping/types.ts';
import { PluginState } from '../state/pluginState.ts';
import { FhemAccessory, type AccessoryPlatform, type Execute } from './accessory.ts';

const lamp: Jsonlist2Device = {
  Internals: { NAME: 'lamp', TYPE: 'dummy', FUUID: 'f-1' },
  Readings: { state: { Value: 'on' } },
  Attributes: {},
  PossibleSets: 'on off',
  PossibleAttrs: '',
};

function create(device: Jsonlist2Device = lamp, execute: Execute = vi.fn<Execute>()) {
  const log = createLog();
  const connection = { base_url: 'http://fhem' };
  const platform = { log, connection } as unknown as AccessoryPlatform;
  const state = new PluginState(hap);
  return { accessory: new FhemAccessory(platform, device, state, execute), state, log, connection, execute };
}

describe('FhemAccessory', () => {
  it('sends its commands over the connection of its platform', () => {
    const { accessory, execute, log, connection } = create();

    accessory.command(accessory.mappings.On as PreparedMapping, false);

    expect(execute).toHaveBeenCalledWith(log, connection, 'set lamp off', undefined);
  });

  it('has no service and no name when its device is not to be published', () => {
    const { accessory } = create({ ...lamp, Attributes: { genericDeviceType: 'ignore' } });

    expect(accessory.service_name).toBeUndefined();
    expect(Object.keys(accessory)).toEqual(['log', 'connection', 'jsFunctions', 'skipped']);
  });

  it('keeps the state of the plugin and the way to fhem to itself', () => {
    const { accessory } = create();

    expect(Object.keys(accessory)).toEqual([
      'log',
      'connection',
      'jsFunctions',
      'service_name',
      'mappings',
      'name',
      'fuuid',
      'alias',
      'siriName',
      'device',
      'type',
      'model',
      'PossibleSets',
      'room',
      'serial',
      'uuid_base',
    ]);
  });

  it('is subscribed with every characteristic once it has its services', () => {
    const { accessory, state } = create();

    const services = accessory.getServices();

    expect(services.map((service) => service.constructor.name)).toEqual(['AccessoryInformation', 'Switch']);
    expect(state.subscriptions.publishedAccessory('lamp')).toBe(accessory);
    expect(accessory.displayName).toBe('f-1');
  });
});
