import * as hap from '@homebridge/hap-nodejs';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createLog } from '../../test/support/log.ts';
import type { PreparedMapping } from '../mapping/types.ts';
import { PluginState } from './pluginState.ts';

let state: PluginState;

beforeEach(() => {
  state = new PluginState(hap);
});

function subscribed(informId: string, setValue = vi.fn()) {
  const characteristic = { setValue, props: { format: 'string' } };
  const mapping = { reading: 'state', informId, characteristic_type: 'X', characteristic, log: createLog() } as unknown as PreparedMapping;
  state.subscriptions.subscribe({ device: 'lamp', mappings: {} }, informId, undefined, mapping);
  return { mapping, setValue };
}

describe('PluginState.update', () => {
  it('keeps the reading and hands the converted value to the characteristic, marked as coming from fhem', () => {
    const { mapping, setValue } = subscribed('lamp-state');

    state.update('lamp-state', 'on');

    expect(state.cache.get('lamp-state')).toBe('on');
    expect(mapping.cached).toBe('on');
    expect(setValue).toHaveBeenCalledWith('on', undefined, 'fromFHEM');
  });

  it('does nothing for a value that is already known, or for no value', () => {
    const { setValue } = subscribed('lamp-state');
    state.update('lamp-state', 'on');

    state.update('lamp-state', 'on');
    state.update('lamp-state', undefined);

    expect(setValue).toHaveBeenCalledOnce();
    expect(state.cache.get('lamp-state')).toBe('on');
  });

  it('can keep a value without telling HomeKit', () => {
    const { mapping, setValue } = subscribed('lamp-state');

    state.update('lamp-state', 'off', true);

    expect(mapping.cached).toBe('off');
    expect(setValue).not.toHaveBeenCalled();
  });

  it('keeps a reading nobody is subscribed to', () => {
    state.update('other-state', 'x');

    expect(state.cache.values).toEqual({ 'other-state': 'x' });
  });

  it('notes when the reading changed', () => {
    vi.useFakeTimers({ now: new Date('2026-08-16T12:00:00Z') });
    const { mapping } = subscribed('lamp-state');

    state.update('lamp-state', 'on');
    vi.useRealTimers();

    expect(mapping.last_update).toBe(1786881600);
  });
});
