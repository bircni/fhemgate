import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { Logging } from 'homebridge';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { createLog } from '../test/support/log.ts';
import { baseUrl, connectionConfigs, isSwitchedOff, loadJsFunctions, optionalSwitch, type ConnectionConfig, type FhemPlatformConfig } from './config.ts';
import { PLATFORM_NAME } from './settings.ts';

const logging = () => {
  const log = createLog();
  return { log, logging: log as unknown as Logging };
};

afterEach(() => {
  vi.restoreAllMocks();
});

describe('connectionConfigs', () => {
  it('is the entry itself, then the connections it lists', () => {
    const second = { server: 'b' };
    const config = { platform: 'FHEM', server: 'a', connections: [second] };

    expect(connectionConfigs(config)).toEqual([config, second]);
  });

  it('is only the connections when the entry names no server', () => {
    const first = { server: 'a' };

    expect(connectionConfigs({ platform: 'FHEM', connections: [first] })).toEqual([first]);
  });

  it('is the entry itself without connections, also when it names no server, which is reported for it', () => {
    const config = { platform: 'FHEM' };

    expect(connectionConfigs(config)).toEqual([config]);
    expect(connectionConfigs({ ...config, connections: [] })).toEqual([{ ...config, connections: [] }]);
  });

  it('leaves out what is no connection', () => {
    expect(connectionConfigs({ platform: 'FHEM', connections: [null, 'b', { server: 'c' }] as never })).toEqual([{ server: 'c' }]);
    expect(connectionConfigs({ platform: 'FHEM', server: 'a', connections: 'b' as never })).toHaveLength(1);
  });
});

describe('baseUrl', () => {
  it('defaults to port 8083 and the webname fhem', () => {
    expect(baseUrl({ server: 'fhem.local' }, logging().logging)).toBe('http://fhem.local:8083/fhem');
  });

  it('uses the port, the webname and https as configured', () => {
    const config = { server: '192.0.2.1', port: '8088', webname: 'haus', ssl: true };

    expect(baseUrl(config, logging().logging)).toBe('https://192.0.2.1:8088/haus');
  });

  it.each(['true', 'TRUE', ' 1 ', 1])('takes %j for ssl as true, with a warning', (ssl) => {
    const exit = vi.spyOn(process, 'exit').mockImplementation(() => undefined as never);
    const { log, logging: target } = logging();

    expect(baseUrl({ server: 'fhem', ssl: ssl as unknown as boolean }, target)).toBe('https://fhem:8083/fhem');

    expect(exit).not.toHaveBeenCalled();
    expect(log.lines).toEqual([`warn config: value for ssl has to be boolean. taking ${JSON.stringify(ssl)} as true.`]);
  });

  it.each(['yes', 'false', '0', 2, {}])('takes %j for ssl as false, with an error, and goes on', (ssl) => {
    const exit = vi.spyOn(process, 'exit').mockImplementation(() => undefined as never);
    const { log, logging: target } = logging();

    expect(baseUrl({ server: 'fhem', ssl: ssl as unknown as boolean }, target)).toBe('http://fhem:8083/fhem');

    expect(exit).not.toHaveBeenCalled();
    expect(log.lines).toEqual([`error config: value for ssl has to be boolean. taking ${JSON.stringify(ssl)} as false.`]);
  });

  it.each([false, undefined, null, '', 0])('says nothing about %j for ssl', (ssl) => {
    const { log, logging: target } = logging();

    expect(baseUrl({ server: 'fhem', ssl: ssl as unknown as boolean }, target)).toBe('http://fhem:8083/fhem');
    expect(log.lines).toEqual([]);
  });
});

describe('isSwitchedOff', () => {
  it.each([false, 'false', ' FALSE ', 0, '0'])('takes %j for off', (value) => {
    expect(isSwitchedOff(value)).toBe(true);
  });

  it.each([undefined, null, true, 'true', 1, '', 'no', {}])('leaves an option on for %j', (value) => {
    expect(isSwitchedOff(value)).toBe(false);
  });
});

describe('optionalSwitch', () => {
  it('is on, off, or not given', () => {
    expect([true, 'true', 1, 'yes'].map(optionalSwitch)).toEqual([true, true, true, true]);
    expect([false, 'false', 0, '0'].map(optionalSwitch)).toEqual([false, false, false, false]);
    expect([undefined, null].map(optionalSwitch)).toEqual([undefined, undefined]);
  });
});

describe('loadJsFunctions', () => {
  it('loads a file relative to the storage directory, or by its full path', () => {
    const storage = mkdtempSync(join(tmpdir(), 'fhemgate-'));
    try {
      writeFileSync(join(storage, 'f.cjs'), 'module.exports = { one: () => 1 };');

      expect(Object.keys(loadJsFunctions('f.cjs', storage, logging().logging) as object)).toEqual(['one']);
      expect(Object.keys(loadJsFunctions(join(storage, 'f.cjs'), '/elsewhere', logging().logging) as object)).toEqual(['one']);
    } finally {
      rmSync(storage, { recursive: true, force: true });
    }
  });

  it('answers nothing and says why when the file can not be loaded', () => {
    const { log, logging: target } = logging();

    expect(loadJsFunctions('missing.cjs', '/nonexistent', target)).toBeUndefined();
    expect(log.lines[0]).toMatch(/^error {3}jsFunctions: Error: Cannot find module/);
  });
});

// the settings form of the homebridge UI is built from config.schema.json. on saving, the UI
// keeps of a platform only what the form has a field for.
describe('config.schema.json', () => {
  interface SchemaProperty {
    type: string;
    title?: string;
    default?: unknown;
    properties?: Record<string, SchemaProperty>;
    items?: SchemaProperty;
  }

  const schema = JSON.parse(readFileSync(join(import.meta.dirname, '..', 'config.schema.json'), 'utf8')) as {
    pluginAlias: string;
    pluginType: string;
    schema: SchemaProperty & { properties: Record<string, SchemaProperty> };
  };

  /** the options the interface names, without what it inherits for any key */
  type Named<T> = { [K in keyof T as string extends K ? never : K]: T[K] };

  // an option that is added to the configuration has to be added here, or this does not compile
  const options: Record<Exclude<keyof Named<FhemPlatformConfig>, 'platform' | '_bridge'>, true> = {
    name: true,
    server: true,
    port: true,
    filter: true,
    ssl: true,
    webname: true,
    auth: true,
    rejectUnauthorized: true,
    jsFunctions: true,
    scope: true,
    neverTimeout: true,
    allowInlineFunctions: true,
    debugPort: true,
    debugHost: true,
    connections: true,
  };

  const all = (properties: Record<string, SchemaProperty>): SchemaProperty[] =>
    Object.values(properties).flatMap((property) => [property, ...all(property.properties ?? {})]);

  it('is for the platform the plugin registers', () => {
    expect(schema.pluginAlias).toBe(PLATFORM_NAME);
    expect(schema.pluginType).toBe('platform');
  });

  it('has a field for every option of the platform, so that the UI drops none on saving', () => {
    expect(Object.keys(schema.schema.properties).sort()).toEqual(Object.keys(options).sort());
  });

  it('offers for each connection the fields the entry has for its fhem, alike', () => {
    const connection: Record<keyof ConnectionConfig, true> = {
      server: true,
      port: true,
      filter: true,
      ssl: true,
      webname: true,
      auth: true,
      rejectUnauthorized: true,
      jsFunctions: true,
      scope: true,
      neverTimeout: true,
      allowInlineFunctions: true,
    };
    const items = schema.schema.properties.connections?.items?.properties ?? {};

    expect(Object.keys(items).sort()).toEqual(Object.keys(connection).sort());
    for (const key of Object.keys(connection)) {
      expect(items[key]).toEqual(schema.schema.properties[key]);
    }
  });

  it('gives every default in the type of its option', () => {
    const typeOf = (value: unknown) => (Number.isInteger(value) ? 'integer' : typeof value);
    const defaults = all(schema.schema.properties).filter((property) => property.default !== undefined);

    expect(defaults.map((property) => [property.title, typeOf(property.default)])).toEqual(defaults.map((property) => [property.title, property.type]));
  });

  it('labels no two fields alike', () => {
    const titles = all(schema.schema.properties).flatMap((property) => property.title ?? []);

    expect(titles).toEqual([...new Set(titles)]);
  });
});
