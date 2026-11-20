// an installation that moves from homebridge-fhem to this plugin has to keep its accessories:
// HomeKit knows an accessory by the uuid homebridge makes for it, and takes one with another
// uuid for a new one, without its room, name, scenes and automations. every device fixture is
// held against what homebridge-fhem 0.5.55 made of it, as written down in support/upstream.ts.
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { IdentityStore, IDENTITIES_FILE } from '../src/devices/identityStore.ts';
import { fixtureDevices } from './support/devices.ts';
import { createWorld } from './support/subject.ts';
import type { Accessory } from './support/types.ts';
import { homebridgeUuid, upstreamIdentity } from './support/upstream.ts';

const fixtures = fixtureDevices();

/** what the homebridgeMapping attribute says for SerialNumber, which homebridge-fhem read the same way */
const serialNumberMapping = (accessory: Accessory) => accessory.mappings.SerialNumber as { serial?: string; value?: string } | undefined;

const identityOf = (accessory: Accessory) => ({ name: accessory.name, serial: accessory.serial, uuid_base: accessory.uuid_base });

/** the platform hands homebridge only the devices that got a service. the others are no accessory and have no identity. */
const isPublished = (accessory: Accessory) => accessory.service_name !== undefined;

let storage: string | undefined;

afterEach(() => {
  if (storage) {
    rmSync(storage, { recursive: true, force: true });
    storage = undefined;
  }
});

describe.each(fixtures.filter((fixture) => isPublished(createWorld().accessory(fixture.load()))))('$id', (fixture) => {
  it('has the name, the serial number and the uuid homebridge-fhem gave it', () => {
    const accessory = createWorld().accessory(fixture.load());
    const before = upstreamIdentity(fixture.load(), serialNumberMapping(accessory));

    expect(identityOf(accessory)).toEqual({ name: before.name, serial: before.serial, uuid_base: before.uuid_base });
    expect(homebridgeUuid(accessory)).toBe(homebridgeUuid(before));
    // a config entry that names the plugin, as "platform": "homebridge-fhem.FHEM", has other uuids. they stay as well.
    expect(homebridgeUuid(accessory, 'homebridge-fhem.FHEM')).toBe(homebridgeUuid(before, 'homebridge-fhem.FHEM'));
  });

  it('is remembered as that on the first start after homebridge-fhem, and stays it', () => {
    storage = mkdtempSync(join(tmpdir(), 'fhemgate-migration-'));
    const platform = () => ({ connection: { base_url: 'http://fhem:8083/fhem' }, identities: new IdentityStore(storage as string) });
    const world = createWorld();

    // homebridge-fhem left no file with identities
    const first = platform();
    const accessory = world.accessory(fixture.load(), first);
    first.identities.save(world.log as never);
    const before = upstreamIdentity(fixture.load(), serialNumberMapping(accessory));

    expect(homebridgeUuid(accessory)).toBe(homebridgeUuid(before));
    expect(homebridgeUuid(world.accessory(fixture.load(), platform()))).toBe(homebridgeUuid(before));
    expect(world.log.lines.filter((line) => line.startsWith('warn ') && line.includes(IDENTITIES_FILE))).toEqual([]);
  });

  it('keeps its Eve history in the file homebridge-fhem kept it in', () => {
    const accessory = createWorld().accessory(fixture.load());
    accessory.getServices();

    // fakegato-history names the file <host>_<displayName>_persist.json, in the storage directory of homebridge
    expect(accessory.displayName).toBe(upstreamIdentity(fixture.load()).displayName);
  });
});

describe('the device fixtures', () => {
  it('cover every rule homebridge-fhem had for the serial number', () => {
    const types = new Set(fixtures.map((fixture) => fixture.load().Internals.TYPE));

    for (const type of [
      'CUL_HM',
      'CUL_WS',
      'Siro',
      'FS20',
      'IT',
      'EnOcean',
      'HUEDevice',
      'SONOSPLAYER',
      'WOL',
      'MAX',
      'DUOFERN',
      'ZWave',
      'HMCCUDEV',
      'HMCCUCHN',
      'dummy',
    ]) {
      expect(types, type).toContain(type);
    }
    expect(
      fixtures.some((fixture) => /SerialNumber=/.test((fixture.load().Attributes as Record<string, string | undefined> | undefined)?.homebridgeMapping ?? '')),
    ).toBe(true);
  });

  it('are remembered by what homebridge-fhem made the uuid from', () => {
    storage = mkdtempSync(join(tmpdir(), 'fhemgate-migration-'));
    const world = createWorld();
    const identities = new IdentityStore(storage);
    const fixture = fixtures.find((candidate) => candidate.load().Internals.TYPE === 'FS20');
    if (!fixture) {
      throw new Error('there is no FS20 fixture');
    }

    world.accessory(fixture.load(), { identities });
    identities.save(world.log as never);

    const stored = JSON.parse(readFileSync(join(storage, IDENTITIES_FILE), 'utf8')) as { identities: Record<string, string> };
    expect(Object.values(stored.identities)).toEqual([upstreamIdentity(fixture.load()).uuid_base]);
  });
});
