import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { Logging } from 'homebridge';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { createLog } from '../test/support/log.ts';
import { baseUrl, loadJsFunctions } from './config.ts';

const logging = () => {
  const log = createLog();
  return { log, logging: log as unknown as Logging };
};

afterEach(() => {
  vi.restoreAllMocks();
});

describe('baseUrl', () => {
  it('defaults to port 8083 and the webname fhem', () => {
    expect(baseUrl({ platform: 'FHEM', server: 'fhem.local' }, logging().logging)).toBe('http://fhem.local:8083/fhem');
  });

  it('uses the port, the webname and https as configured', () => {
    const config = { platform: 'FHEM', server: '192.0.2.1', port: '8088', webname: 'haus', ssl: true };

    expect(baseUrl(config, logging().logging)).toBe('https://192.0.2.1:8088/haus');
  });

  it('ends the process for an ssl setting that is no boolean', () => {
    const exit = vi.spyOn(process, 'exit').mockImplementation(() => undefined as never);
    const { log, logging: target } = logging();

    baseUrl({ platform: 'FHEM', server: 'fhem', ssl: 'yes' as unknown as boolean }, target);

    expect(exit).toHaveBeenCalledWith(0);
    expect(log.lines).toEqual(['error config: value for ssl has to be boolean.']);
  });
});

describe('loadJsFunctions', () => {
  it('loads a file relative to the storage directory, or by its full path', () => {
    const storage = mkdtempSync(join(tmpdir(), 'fhem2hb-'));
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
