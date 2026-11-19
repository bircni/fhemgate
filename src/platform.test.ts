import * as hap from '@homebridge/hap-nodejs';
import type { API, Logging } from 'homebridge';
import { describe, expect, it, vi } from 'vitest';
import { createLog } from '../test/support/log.ts';
import createPluginFor, { createPlugin } from './index.ts';
import { FhemPlatform, sortByKey, version, type Plugin } from './platform.ts';
import { PluginState } from './state/pluginState.ts';

const api = () => ({
  hap, on: vi.fn(), version: 2.7, user: { storagePath: () => '/nonexistent' }, registerPlatform: vi.fn(),
}) as unknown as API;

describe('FhemPlatform', () => {
  it('has no connection and no accessories without a server', () => {
    const log = createLog();
    const plugin: Plugin = { state: new PluginState(hap), storagePath: () => '/nonexistent' };
    const platform = new FhemPlatform(log as unknown as Logging, { platform: 'FHEM' }, api(), plugin);
    const answered = vi.fn();

    platform.accessories(answered);

    expect(platform.connection).toBeUndefined();
    expect(answered).toHaveBeenCalledWith([]);
    expect(log.lines).toEqual(['error incomplete configuration ']);
  });

  it('knows its version', () => {
    expect(version).toMatch(/^\d+\.\d+\.\d+/);
  });
});

describe('the plugin', () => {
  it('gives all its platforms the same state', () => {
    const plugin = createPlugin(api());
    const log = createLog() as unknown as Logging;

    const first = new plugin.Platform(log, { platform: 'FHEM' }, api());
    const second = new plugin.Platform(log, { platform: 'FHEM' }, api());
    plugin.state.subscriptions.subscribe({ device: 'lamp', mappings: {}, historyService: undefined }, 'lamp-state');
    first.shutdown();

    expect(first).toBeInstanceOf(FhemPlatform);
    expect(second).toBeInstanceOf(FhemPlatform);
    expect(plugin.state.subscriptions.byInformId['lamp-state']?.[0]?.accessory.shutdown).toBe(true);
  });

  it('registers its platform under the name FHEM', () => {
    const homebridge = api();

    createPluginFor(homebridge);

    expect(homebridge.registerPlatform).toHaveBeenCalledWith('FHEM', expect.any(Function));
  });
});

describe('sortByKey', () => {
  it('sorts in place', () => {
    const list = [{ Name: 'b' }, { Name: 'a' }];

    expect(sortByKey(list, 'Name')).toBe(list);
    expect(list).toEqual([{ Name: 'a' }, { Name: 'b' }]);
  });
});
