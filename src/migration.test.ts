import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import * as hap from '@homebridge/hap-nodejs';
import type { API, Logging } from 'homebridge';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createLog } from '../test/support/log.ts';
import { configFindings, findOldPlugin, installationWarnings } from './migration.ts';
import { FhemPlatform, type Plugin } from './platform.ts';
import { PluginState } from './state/pluginState.ts';

let directory: string;
/** where this plugin is installed */
let pluginRoot: string;
let configPath: string;

/** installs a package next to this plugin */
function install(name: string, manifest: unknown = { name }): string {
  const target = join(directory, 'node_modules', name);
  mkdirSync(target, { recursive: true });
  writeFileSync(join(target, 'package.json'), typeof manifest === 'string' ? manifest : JSON.stringify(manifest));
  return target;
}

const configure = (config: unknown) => {
  writeFileSync(configPath, typeof config === 'string' ? config : JSON.stringify(config));
};

beforeEach(() => {
  directory = mkdtempSync(join(tmpdir(), 'fhem2hb-migration-'));
  pluginRoot = install('homebridge-fhem2hb');
  configPath = join(directory, 'config.json');
  configure({ bridge: {}, platforms: [{ platform: 'config' }, { platform: 'FHEM', server: 'fhem' }] });
});

afterEach(() => {
  rmSync(directory, { recursive: true, force: true });
});

describe('findOldPlugin', () => {
  it('finds homebridge-fhem in the node_modules directory this plugin is installed in', () => {
    const old = install('homebridge-fhem');

    expect(findOldPlugin(pluginRoot)).toBe(old);
  });

  it('finds nothing when it is not installed', () => {
    install('homebridge-hue');

    expect(findOldPlugin(pluginRoot)).toBeUndefined();
  });

  it('takes a directory of that name for it only if its package.json says so', () => {
    install('homebridge-fhem', { name: 'something-else' });
    expect(findOldPlugin(pluginRoot)).toBeUndefined();

    install('homebridge-fhem', '{"name":');
    expect(findOldPlugin(pluginRoot)).toBeUndefined();

    install('homebridge-fhem', 'null');
    expect(findOldPlugin(pluginRoot)).toBeUndefined();
  });

  it('does not look next to a checkout of this plugin, which is in no node_modules directory', () => {
    const checkout = join(directory, 'fhem2hb');
    mkdirSync(join(directory, 'homebridge-fhem'), { recursive: true });
    writeFileSync(join(directory, 'homebridge-fhem', 'package.json'), JSON.stringify({ name: 'homebridge-fhem' }));

    expect(findOldPlugin(checkout)).toBeUndefined();
  });
});

describe('installationWarnings', () => {
  it('has nothing to say when homebridge-fhem is not installed', () => {
    expect(installationWarnings(pluginRoot, configPath)).toEqual([]);
  });

  it('says where homebridge-fhem is, what homebridge does about it and what to do', () => {
    const old = install('homebridge-fhem');

    const warnings = installationWarnings(pluginRoot, configPath);

    expect(warnings).toHaveLength(1);
    expect(warnings[0]).toContain(`homebridge-fhem is installed as well, in ${old}.`);
    expect(warnings[0]).toContain('"platform": "FHEM"');
    expect(warnings[0]).toContain('HomeKit forgets them');
    expect(warnings[0]).toContain('uninstall homebridge-fhem');
  });

  it('has nothing to say when homebridge-fhem is disabled, as homebridge then loads the platform from this plugin', () => {
    install('homebridge-fhem');
    configure({ disabledPlugins: ['homebridge-fhem'], platforms: [{ platform: 'FHEM' }] });

    expect(installationWarnings(pluginRoot, configPath)).toEqual([]);
  });

  it('has nothing to say when every FHEM platform names its plugin', () => {
    install('homebridge-fhem');
    configure({ platforms: [{ platform: 'homebridge-fhem.FHEM' }, { platform: 'homebridge-fhem2hb.FHEM' }, null, { name: 'no platform' }] });

    expect(installationWarnings(pluginRoot, configPath)).toEqual([]);
  });

  it('has nothing to say when no FHEM platform is configured', () => {
    install('homebridge-fhem');
    configure({ bridge: {} });

    expect(installationWarnings(pluginRoot, configPath)).toEqual([]);
  });

  it.each([
    ['is missing', undefined],
    ['is damaged', '{"platforms": ['],
    ['holds something else', 'null'],
  ])('warns when the config.json %s, as it can not tell', (_what, content) => {
    install('homebridge-fhem');
    if (content === undefined) {
      rmSync(configPath);
    } else {
      configure(content);
    }

    expect(installationWarnings(pluginRoot, configPath)).toHaveLength(1);
  });

  it('warns when the list of disabled plugins is no list or names other plugins', () => {
    install('homebridge-fhem');

    configure({ disabledPlugins: 'homebridge-fhem', platforms: [{ platform: 'FHEM' }] });
    expect(installationWarnings(pluginRoot, configPath)).toHaveLength(1);

    configure({ disabledPlugins: ['homebridge-hue'], platforms: [{ platform: 'FHEM' }] });
    expect(installationWarnings(pluginRoot, configPath)).toHaveLength(1);
  });
});

describe('configFindings', () => {
  const findings = (auth: unknown) => configFindings({ platform: 'FHEM', server: 'fhem', auth: auth as never });

  it('finds nothing in a configuration this plugin acts on completely', () => {
    expect(configFindings({ platform: 'FHEM' })).toEqual([]);
    expect(findings({ user: 'homebridge', pass: 'secret' })).toEqual([]);
    expect(findings({ username: 'homebridge', password: 'secret' })).toEqual([]);
    expect(findings(null)).toEqual([]);
    expect(findings('homebridge:secret')).toEqual([]);
  });

  it.each([false, 'false', 0, null])(
    'warns about auth.sendImmediately %j, which asked for digest authentication where FHEMWEB wanted it',
    (sendImmediately) => {
      const found = findings({ user: 'homebridge', pass: 'secret', sendImmediately });

      expect(found).toHaveLength(1);
      expect(found[0]?.level).toBe('warn');
      expect(found[0]?.text).toContain('auth.sendImmediately is not used any more');
      expect(found[0]?.text).toContain('digest authentication is not possible');
      expect(found[0]?.text).toContain('remove auth.sendImmediately');
    },
  );

  it('only notes auth.sendImmediately true, which is what the plugin does anyway', () => {
    expect(findings({ user: 'homebridge', pass: 'secret', sendImmediately: true })).toEqual([
      {
        level: 'info',
        text: 'config: auth.sendImmediately is not needed any more and can be removed. user and password are always sent with the first request.',
      },
    ]);
  });

  it('warns about auth.bearer, which is not sent', () => {
    const found = findings({ bearer: 'token', sendImmediately: true });

    expect(found.map(({ level }) => level)).toEqual(['info', 'warn']);
    expect(found[1]?.text).toContain('auth.bearer is not supported');
    expect(found[1]?.text).toContain('remove auth.bearer');
  });
});

describe('configFindings for a platform that names its plugin', () => {
  it('notes that an entry that names homebridge-fhem has to stay as it is', () => {
    const found = configFindings({ platform: 'homebridge-fhem.FHEM', server: 'fhem' });

    expect(found).toHaveLength(1);
    expect(found[0]?.level).toBe('info');
    expect(found[0]?.text).toContain('"platform": "homebridge-fhem.FHEM"');
    expect(found[0]?.text).toContain('leave it as it is');
  });

  it('has nothing to say about an entry that names this plugin or no plugin', () => {
    expect(configFindings({ platform: 'homebridge-fhem2hb.FHEM' })).toEqual([]);
    expect(configFindings({ platform: 'FHEM' })).toEqual([]);
  });
});

describe('a platform', () => {
  const api = () => ({ hap, on: vi.fn() }) as unknown as API;
  const plugin = (): Plugin => ({ state: new PluginState(hap), storagePath: () => directory, debugServers: new Map() });

  it('logs what it found in its configuration, and goes on', () => {
    const log = createLog();

    // no server, so that it does not connect
    const platform = new FhemPlatform(
      log as unknown as Logging,
      { platform: 'FHEM', debugPort: false, auth: { user: 'homebridge', pass: 'secret', sendImmediately: false, bearer: 'token' } as never },
      api(),
      plugin(),
    );

    expect(platform).toBeInstanceOf(FhemPlatform);
    expect(log.lines.map((line) => line.split('.').slice(0, 2).join('.'))).toEqual([
      'warn config: auth.sendImmediately is not used any more',
      'warn config: auth.bearer is not supported',
      'error incomplete configuration ',
    ]);
  });

  it('logs nothing more than before for a configuration without such keys', () => {
    const log = createLog();

    const platform = new FhemPlatform(
      log as unknown as Logging,
      { platform: 'FHEM', debugPort: false, auth: { user: 'homebridge', pass: 'secret' } },
      api(),
      plugin(),
    );

    expect(platform.connection).toBeUndefined();

    expect(log.lines).toEqual(['error incomplete configuration ']);
  });
});
