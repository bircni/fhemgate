import { join } from 'node:path';
import * as hap from '@homebridge/hap-nodejs';
import type { API } from 'homebridge';
import { afterEach, beforeEach, describe, expect, it, vi, type MockInstance } from 'vitest';
import initializer from './index.ts';
import { installationWarnings } from './migration.ts';

vi.mock('./migration.ts', async (original) => ({
  ...(await original<typeof import('./migration.ts')>()),
  installationWarnings: vi.fn(() => []),
}));

const homebridge = (user: Record<string, unknown>) => ({ hap, version: 2.7, user, registerPlatform: vi.fn(), on: vi.fn() }) as unknown as API;

let warned: MockInstance<typeof console.warn>;

beforeEach(() => {
  vi.spyOn(console, 'log').mockImplementation(() => undefined);
  vi.spyOn(console, 'info').mockImplementation(() => undefined);
  warned = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
});

afterEach(() => {
  vi.restoreAllMocks();
  vi.mocked(installationWarnings).mockReset().mockReturnValue([]);
});

describe('loading the plugin', () => {
  it('looks at where it is installed and at the config.json of homebridge', () => {
    initializer(homebridge({ storagePath: () => '/storage', configPath: () => '/storage/config.json' }));

    expect(installationWarnings).toHaveBeenCalledWith(join(import.meta.dirname, '..'), '/storage/config.json');
    expect(warned).not.toHaveBeenCalled();
  });

  it('prints what is wrong with the installation under its name, and registers the platform all the same', () => {
    vi.mocked(installationWarnings).mockReturnValue(['homebridge-fhem is installed as well.']);
    const api = homebridge({ storagePath: () => '/storage', configPath: () => '/storage/config.json' });

    initializer(api);

    expect(warned.mock.calls).toEqual([['homebridge-fhemgate: homebridge-fhem is installed as well.']]);
    expect(api.registerPlatform).toHaveBeenCalledOnce();
  });

  it('loads when the look around fails', () => {
    vi.mocked(installationWarnings).mockImplementation(() => {
      throw new Error('boom');
    });
    const api = homebridge({ storagePath: () => '/storage', configPath: () => '/storage/config.json' });

    initializer(api);

    expect(warned).not.toHaveBeenCalled();
    expect(api.registerPlatform).toHaveBeenCalledOnce();
  });

  it('loads in a homebridge that does not say where its config.json is', () => {
    const api = homebridge({ storagePath: () => '/storage' });

    initializer(api);

    expect(installationWarnings).not.toHaveBeenCalled();
    expect(api.registerPlatform).toHaveBeenCalledOnce();
  });
});
