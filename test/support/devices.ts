import { readdirSync, readFileSync } from 'node:fs';
import { join, relative } from 'node:path';
import type { FhemDevice } from './types.ts';

const fixtures = join(import.meta.dirname, '..', 'fixtures', 'devices');

export interface DeviceOptions {
  Internals?: Record<string, string>;
  Attributes?: Record<string, string>;
  Readings?: Record<string, string | number>;
  PossibleSets?: string;
  PossibleAttrs?: string;
}

/** a device as fhem would report it, with only the interesting parts spelled out */
export function device(options: DeviceOptions): FhemDevice {
  const readings: FhemDevice['Readings'] = {};
  for (const [name, value] of Object.entries(options.Readings ?? {})) {
    readings[name] = { Value: String(value), Time: '2026-08-16 12:00:00' };
  }

  return {
    Internals: { NAME: 'test', TYPE: 'dummy', FUUID: '5f0d1e7a-f33f-1a2b-3c4d-000000000001', ...options.Internals },
    Attributes: { ...options.Attributes },
    Readings: readings,
    PossibleSets: options.PossibleSets ?? '',
    PossibleAttrs: options.PossibleAttrs ?? '',
  };
}

/** a HMCCU channel device */
export function hmccuDevice(options: DeviceOptions): FhemDevice {
  return device({ ...options, Internals: { TYPE: 'HMCCUCHN', DEF: 'CCU 000ABC:4', ...options.Internals } });
}

export interface Fixture {
  /** family/name, without the extension */
  id: string;
  /** a fresh copy of the device on every call, as the plugin changes what it is given */
  load(): FhemDevice;
}

function files(directory: string): string[] {
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const path = join(directory, entry.name);
    if (entry.isDirectory()) {
      return files(path);
    }
    return entry.name.endsWith('.json') ? [path] : [];
  });
}

/** every device under test/fixtures/devices */
export function fixtureDevices(): Fixture[] {
  return files(fixtures)
    .sort()
    .map((path) => ({
      id: relative(fixtures, path)
        .replace(/\.json$/, '')
        .split('\\')
        .join('/'),
      load: () => JSON.parse(readFileSync(path, 'utf8')) as FhemDevice,
    }));
}

/**
 * The device of a fixture, as fhem lists it.
 *
 * @param id family/name, without the extension
 * @param change what to change about the device first
 */
export function fixtureDevice(id: string, change: (device: FhemDevice) => void = () => {}): FhemDevice {
  const found = fixtureDevices().find((candidate) => candidate.id === id);
  if (!found) {
    throw new Error(`there is no fixture ${id}`);
  }
  const loaded = found.load();
  change(loaded);
  return loaded;
}
