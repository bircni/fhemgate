import * as hap from '@homebridge/hap-nodejs';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createLog } from '../../test/support/log.ts';
import type { PreparedMapping } from '../mapping/types.ts';
import { PluginState } from './pluginState.ts';

let state: PluginState;

beforeEach(() => {
  state = new PluginState(hap);
});

function subscribed(informId: string, updateValue = vi.fn()) {
  const characteristic = { updateValue, props: { format: 'string' } };
  const mapping = { reading: 'state', informId, characteristic_type: 'X', characteristic, log: createLog() } as unknown as PreparedMapping;
  state.subscriptions.subscribe({ device: 'lamp', mappings: {} }, informId, undefined, mapping);
  return { mapping, updateValue };
}

describe('PluginState.changesOf', () => {
  it('counts the events of a reading and the values the plugin sets itself, and no answer of fhem', () => {
    state.update('lamp-state', 'on');
    state.update('lamp-state', 'on');
    state.answer('lamp-state', 'off');
    state.update('lamp-state', 'on', true);

    expect(state.changesOf('lamp-state')).toBe(3);
    expect(state.changesOf('lamp-other')).toBe(0);
    expect(state.cache.get('lamp-state')).toBe('on');
  });

  it('notes when a value changed, and not when it is repeated', () => {
    vi.useFakeTimers({ now: new Date('2026-01-01T00:00:00Z') });
    state.update('lamp-state', 'on');
    vi.setSystemTime(new Date('2026-01-01T00:01:00Z'));
    state.answer('lamp-state', 'on');

    expect(state.cache.changed['lamp-state']).toBe(Date.parse('2026-01-01T00:00:00Z') / 1000);
    vi.useRealTimers();
  });
});

describe('PluginState.update', () => {
  it('keeps the reading and publishes the converted value at the characteristic without running its set handler', () => {
    const { mapping, updateValue } = subscribed('lamp-state');

    state.update('lamp-state', 'on');

    expect(state.cache.get('lamp-state')).toBe('on');
    expect(mapping.cached).toBe('on');
    expect(updateValue).toHaveBeenCalledWith('on');
  });

  it('does nothing for a value that is already known, or for no value', () => {
    const { updateValue } = subscribed('lamp-state');
    state.update('lamp-state', 'on');

    state.update('lamp-state', 'on');
    state.update('lamp-state', undefined);

    expect(updateValue).toHaveBeenCalledOnce();
    expect(state.cache.get('lamp-state')).toBe('on');
  });

  it('can keep a value without telling HomeKit', () => {
    const { mapping, updateValue } = subscribed('lamp-state');

    state.update('lamp-state', 'off', true);

    expect(mapping.cached).toBe('off');
    expect(updateValue).not.toHaveBeenCalled();
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
