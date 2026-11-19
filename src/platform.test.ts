import * as hap from '@homebridge/hap-nodejs';
import type { API, Logging } from 'homebridge';
import { createServer } from 'node:http';
import type { AddressInfo } from 'node:net';
import { describe, expect, it, vi } from 'vitest';
import { createLog } from '../test/support/log.ts';
import createPluginFor, { createPlugin } from './index.ts';
import { FhemPlatform, sortByKey, version, type Plugin } from './platform.ts';
import { PluginState } from './state/pluginState.ts';

const api = () =>
  ({
    hap,
    on: vi.fn(),
    version: 2.7,
    user: { storagePath: () => '/nonexistent' },
    registerPlatform: vi.fn(),
  }) as unknown as API;

describe('FhemPlatform', () => {
  it('has no connection and no accessories without a server', () => {
    const log = createLog();
    const plugin: Plugin = { state: new PluginState(hap), storagePath: () => '/nonexistent', debugServers: new Map() };
    const platform = new FhemPlatform(log as unknown as Logging, { platform: 'FHEM', debugPort: false }, api(), plugin);
    const answered = vi.fn();

    platform.accessories(answered);

    expect(platform.connection).toBeUndefined();
    expect(answered).toHaveBeenCalledWith([]);
    expect(log.lines).toEqual(['error incomplete configuration ']);
  });

  it.each([false, 0, 'false'])('starts no debug server when the configuration says %j for its port', (debugPort) => {
    const plugin: Plugin = { state: new PluginState(hap), storagePath: () => '/nonexistent', debugServers: new Map() };
    const log = createLog();

    const platform = new FhemPlatform(log as unknown as Logging, { platform: 'FHEM', debugPort: debugPort as false }, api(), plugin);

    expect(platform.config.debugPort).toBe(debugPort);
    expect(plugin.debugServers.size).toBe(0);
    expect(log.lines).toEqual(['error incomplete configuration ']);
  });

  it('starts one debug server for a port, also when two platforms name it, and stops it when homebridge shuts down', async () => {
    const plugin: Plugin = { state: new PluginState(hap), storagePath: () => '/nonexistent', debugServers: new Map() };
    const probe = createServer();
    await new Promise<void>((resolve) => probe.listen(0, '127.0.0.1', resolve));
    const debugPort = (probe.address() as AddressInfo).port;
    await new Promise((resolve) => probe.close(resolve));
    const log = createLog();

    const config = { platform: 'FHEM', debugPort, debugHost: '127.0.0.1' };
    const platform = new FhemPlatform(log as unknown as Logging, config, api(), plugin);
    const server = plugin.debugServers.get(debugPort);
    const second = new FhemPlatform(log as unknown as Logging, config, api(), plugin);
    expect(second.config.debugPort).toBe(debugPort);
    expect(plugin.debugServers.get(debugPort)).toBe(server);
    await new Promise((resolve) => server?.once('listening', resolve));

    expect(plugin.debugServers.size).toBe(1);
    expect(server?.address()).toMatchObject({ address: '127.0.0.1', port: debugPort });
    expect(await (await fetch(`http://127.0.0.1:${debugPort}/`)).text()).toContain('<a href="/cached">cached</a>');
    expect(log.lines.filter((line) => line.includes('debug'))).toEqual([`info debug server listening on http://127.0.0.1:${debugPort}`]);

    server?.closeAllConnections();
    platform.shutdown();

    expect(server?.listening).toBe(false);
    expect(plugin.debugServers.size).toBe(0);
  });

  it('serves the debug page on all addresses of the machine unless the configuration names one', async () => {
    const plugin: Plugin = { state: new PluginState(hap), storagePath: () => '/nonexistent', debugServers: new Map() };
    const probe = createServer();
    await new Promise<void>((resolve) => probe.listen(0, resolve));
    const debugPort = (probe.address() as AddressInfo).port;
    await new Promise((resolve) => probe.close(resolve));
    const log = createLog();

    const platform = new FhemPlatform(log as unknown as Logging, { platform: 'FHEM', debugPort }, api(), plugin);
    const server = plugin.debugServers.get(debugPort);
    await new Promise((resolve) => server?.once('listening', resolve));

    expect(['::', '0.0.0.0']).toContain((server?.address() as AddressInfo | undefined)?.address);
    expect(log.lines.filter((line) => line.includes('debug'))).toEqual([`info debug server listening on http://<ip>:${debugPort}`]);

    platform.shutdown();
  });

  it('starts no debug server for something that is no port', () => {
    const plugin: Plugin = { state: new PluginState(hap), storagePath: () => '/nonexistent', debugServers: new Map() };
    const log = createLog();

    const platform = new FhemPlatform(log as unknown as Logging, { platform: 'FHEM', debugPort: 'yes' as unknown as number }, api(), plugin);

    expect(platform.config.debugPort).toBe('yes');
    expect(plugin.debugServers.size).toBe(0);
    expect(log.lines[0]).toBe('error config: value for debugPort has to be a port number or false. the debug server is not started.');
  });

  it('knows its version', () => {
    expect(version).toMatch(/^\d+\.\d+\.\d+/);
  });
});

describe('the plugin', () => {
  it('gives all its platforms the same state', () => {
    const plugin = createPlugin(api());
    const log = createLog() as unknown as Logging;

    const first = new plugin.Platform(log, { platform: 'FHEM', debugPort: false }, api());
    const second = new plugin.Platform(log, { platform: 'FHEM', debugPort: false }, api());
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
