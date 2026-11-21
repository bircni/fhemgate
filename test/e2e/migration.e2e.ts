// an installation that moves from homebridge-fhem to this plugin: the storage directory of
// homebridge is as homebridge-fhem 0.5.55 left it, the config.json is the one written for it,
// and the plugin that homebridge loads is this one.
//
// HomeKit knows an accessory by the id homebridge gave it, which homebridge keeps by the uuid of
// the accessory in persist/IdentifierCache.<bridge>.json. An accessory that comes up with another
// uuid gets a new id, and HomeKit takes it for a new accessory without room, scenes and
// automations. So the directory is given such a file with ids no fresh start would hand out, and
// the accessories have to come up with exactly those.
//
// the devices are of fhem modules a real fhem has only with their hardware, so this runs
// against the stand-in only.
import { cpSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, symlinkSync, writeFileSync } from 'node:fs';
import { hostname } from 'node:os';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, inject, it } from 'vitest';
import { device } from '../support/devices.ts';
import type { FhemDevice } from '../support/types.ts';
import { homebridgeUuid, upstreamIdentity } from '../support/upstream.ts';
import { realFhemUrl, startStandIn, type StandIn } from './fhem.ts';
import { eveType, hapType, startHomebridge, storedFiles, type HapAccessory, type Homebridge } from './homebridge.ts';
import { eventually, published, worldOf, type World } from './world.ts';

const root = join(import.meta.dirname, '..', '..');

// the uuids of HomeKit in full, as homebridge writes them into its file
const full = (short: string) => `${short.padStart(8, '0')}-0000-1000-8000-0026BB765291`;

interface Migrated {
  device: FhemDevice;
  /** the id homebridge had given the accessory while homebridge-fhem ran */
  aid: number;
  /** what HomeKit is told as its name */
  name: string;
  /** what homebridge-fhem showed as its serial number and made its uuid from */
  serial: string;
}

const switchable = { Readings: { state: 'off' }, PossibleSets: 'on off' };
const inRoom = (attributes: Record<string, string> = {}) => ({ room: 'HomeKit', ...attributes });

// one device for every way homebridge-fhem knew to make a serial number, with ids out of order
const migrated: Migrated[] = [
  {
    device: device({
      ...switchable,
      Internals: { NAME: 'Wohnzimmer_Lampe', FUUID: '65a1b2c3-f33f-1a2b-0001-aaaaaaaaaaaa' },
      Attributes: inRoom({ alias: 'Stehlampe' }),
    }),
    aid: 12,
    name: 'Stehlampe',
    serial: '65a1b2c3-f33f-1a2b-0001-aaaaaaaaaaaa',
  },
  {
    device: device({
      ...switchable,
      Internals: { NAME: 'HM_Steckdose', TYPE: 'CUL_HM', DEF: '2A3B4C', FUUID: '65a1b2c3-f33f-1a2b-0002-aaaaaaaaaaaa' },
      Readings: { state: 'off', 'D-serialNr': 'LEQ0123456' },
      Attributes: inRoom(),
    }),
    aid: 7,
    name: 'HM_Steckdose',
    serial: 'LEQ0123456',
  },
  {
    device: device({
      Internals: { NAME: 'HUEDevice1', TYPE: 'HUEDevice', uniqueid: '00:17:88:01:02:03:04:05-0b', FUUID: '65a1b2c3-f33f-1a2b-0003-aaaaaaaaaaaa' },
      Readings: { state: 'on', onoff: '1' },
      PossibleSets: 'on off',
      Attributes: inRoom({ siriName: 'Leselicht' }),
    }),
    aid: 31,
    name: 'Leselicht',
    serial: '00:17:88:01:02:03:04:05-0b',
  },
  {
    device: device({
      ...switchable,
      Internals: { NAME: 'ZWave_Schalter', TYPE: 'ZWave', DEF: 'c1e2f3a4 5', FUUID: '65a1b2c3-f33f-1a2b-0004-aaaaaaaaaaaa' },
      Attributes: inRoom(),
    }),
    aid: 44,
    name: 'ZWave_Schalter',
    serial: 'ZWave.c1e2f3a4-5',
  },
  {
    device: device({
      ...switchable,
      Internals: { NAME: 'FS20_Flur', TYPE: 'FS20', DEF: '1234 01', FUUID: '65a1b2c3-f33f-1a2b-0005-aaaaaaaaaaaa' },
      Attributes: inRoom(),
    }),
    aid: 5,
    name: 'FS20_Flur',
    serial: 'FS20.1234 01',
  },
  {
    device: device({
      ...switchable,
      Internals: { NAME: 'Briefkasten', FUUID: '65a1b2c3-f33f-1a2b-0006-aaaaaaaaaaaa' },
      Attributes: inRoom({ homebridgeMapping: 'SerialNumber=serial=POST-1' }),
    }),
    aid: 23,
    name: 'Briefkasten',
    serial: 'POST-1',
  },
  {
    device: device({
      Internals: { NAME: 'Regal', FUUID: '65a1b2c3-f33f-1a2b-0007-aaaaaaaaaaaa' },
      Readings: { state: 'on', level: '128' },
      PossibleSets: 'on off',
      Attributes: inRoom({ genericDeviceType: 'light', homebridgeMapping: 'Brightness=level,reading2homekit=half' }),
    }),
    aid: 40,
    name: 'Regal',
    serial: '65a1b2c3-f33f-1a2b-0007-aaaaaaaaaaaa',
  },
  {
    device: device({
      Internals: { NAME: 'Haustuer', FUUID: '65a1b2c3-f33f-1a2b-0008-aaaaaaaaaaaa' },
      Readings: { state: 'closed' },
      Attributes: inRoom({
        genericDeviceType: 'ContactSensor',
        homebridgeMapping: 'ContactSensorState=state,values=closed:CONTACT_DETECTED;open:CONTACT_NOT_DETECTED history=size=1024',
      }),
    }),
    aid: 58,
    name: 'Haustuer',
    serial: '65a1b2c3-f33f-1a2b-0008-aaaaaaaaaaaa',
  },
];

// the filter of the platform leaves this one out, as it did before
const elsewhere = device({ ...switchable, Internals: { NAME: 'Keller', FUUID: '65a1b2c3-f33f-1a2b-0009-aaaaaaaaaaaa' }, Attributes: { room: 'Keller' } });

const lamp = migrated[0] as Migrated;
const door = migrated[7] as Migrated;
/** the id HomeKit knows the On characteristic of the lamp by, which a scene that switches the lamp refers to */
const lampOn = 37;

/** the uuid homebridge made for the accessory while homebridge-fhem ran, for what the config entry says as its platform */
const uuidBefore = ({ device: d }: Migrated, platform: string) => {
  const given = /SerialNumber=serial=(\S+)/.exec(d.Attributes.homebridgeMapping ?? '')?.[1];
  return homebridgeUuid(upstreamIdentity(d, given === undefined ? undefined : { serial: given }), platform);
};

const seconds = (date: string) => Date.parse(date) / 1000;
/** fakegato-history counts its reference time from 2001 */
const eveEpoch = 978307200;
const historyStart = seconds('2026-10-01T08:00:00Z');

/** the history of the door as fakegato-history wrote it under homebridge-fhem: opened and closed once, and seven openings counted */
const doorHistory = {
  firstEntry: 0,
  lastEntry: 4,
  usedMemory: 4,
  refTime: historyStart - eveEpoch,
  initialTime: historyStart,
  history: [
    'noValue',
    { time: historyStart, setRefTime: 1 },
    { time: historyStart, status: 0 },
    { time: historyStart + 600, status: 1 },
    { time: historyStart + 660, status: 0 },
  ],
  extra: { TimesOpened: 7, LastActivation: 660, OpenDuration: 0, ClosedDuration: 0, reset: 0 },
};

interface IdentifierCache {
  cache: Record<string, number>;
}

const identifierCacheOf = (storage: string, username: string) => join(storage, 'persist', `IdentifierCache.${username.replaceAll(':', '')}.json`);

/**
 * A storage directory of homebridge as it is after homebridge-fhem ran in it with the migrated
 * devices: the ids of the accessories, the history of the door in the file fakegato-history
 * named after the FUUID of the device, the file with the functions for mappings, and nothing of
 * this plugin.
 *
 * @param platform what the config entry says as its platform, which is part of every uuid
 */
function storageAfterHomebridgeFhem(username: string, platform: string): string {
  const storage = mkdtempSync(join(inject('e2eDirectory'), 'homebridge-'));

  const cache: Record<string, number> = { '|nextAID': 60 };
  for (const entry of migrated) {
    cache[uuidBefore(entry, platform)] = entry.aid;
  }
  cache[`${uuidBefore(lamp, platform)}|${full(hapType.Switch)}|${full(hapType.On)}`] = lampOn;
  cache[`${uuidBefore(lamp, platform)}|nextIID`] = 50;
  mkdirSync(join(storage, 'persist'));
  writeFileSync(identifierCacheOf(storage, username), JSON.stringify({ cache } satisfies IdentifierCache));

  // homebridge keeps the accessories of dynamic platforms here. a static platform like FHEM has none.
  mkdirSync(join(storage, 'accessories'));
  writeFileSync(join(storage, 'accessories', 'cachedAccessories'), '[]');

  writeFileSync(join(storage, `${hostname().split('.')[0]}_${door.device.Internals.FUUID}_persist.json`), JSON.stringify(doorHistory));
  writeFileSync(join(storage, 'fhem-functions.js'), 'module.exports = { half: function(mapping, orig) { return Math.round(Number(orig) / 2); } };');

  return storage;
}

/** the uuids of the accessories in the file homebridge keeps the ids in, with their ids */
function accessoryIds(storage: string, username: string): Record<string, number> {
  const { cache } = JSON.parse(readFileSync(identifierCacheOf(storage, username), 'utf8')) as IdentifierCache;
  return Object.fromEntries(Object.entries(cache).filter(([key]) => !key.includes('|')));
}

const idsBefore = (platform: string) => Object.fromEntries(migrated.map((entry) => [uuidBefore(entry, platform), entry.aid]));

const serialNumberOf = (accessory: HapAccessory) =>
  accessory.services
    .find((service) => service.type === hapType.AccessoryInformation)
    ?.characteristics.find((characteristic) => characteristic.type === hapType.SerialNumber)?.value;

/** a plugin for homebridge, as files in its directory */
interface PluginFiles {
  manifest: Record<string, unknown>;
  index: string;
}

/**
 * Another plugin with one accessory of its own. With it the bridge is not empty when homebridge
 * publishes it, which is when homebridge drops the ids of every accessory that is not on it.
 */
const otherPlugin: PluginFiles = {
  manifest: { name: 'homebridge-e2e-other', version: '1.0.0', main: 'index.js', keywords: ['homebridge-plugin'], engines: { homebridge: '>=1.0.0' } },
  index:
    "module.exports = function (api) { api.registerPlatform('e2e-other', function () { this.accessories = function (callback) { " +
    "callback([{ name: 'Other', getServices: function () { return [new api.hap.Service.Switch('Other')]; } }]); }; }); };",
};

/** what homebridge-fhem is to homebridge: a plugin that registers the platform FHEM, here without accessories */
const homebridgeFhem: PluginFiles = {
  manifest: { name: 'homebridge-fhem', version: '0.5.55', main: 'index.js', keywords: ['homebridge-plugin'], engines: { homebridge: '>=0.2.0' } },
  index:
    "module.exports = function (homebridge) { homebridge.registerPlatform('homebridge-fhem', 'FHEM', function () { this.accessories = function (callback) { callback([]); }; }); };",
};

/** a node_modules directory with this plugin as it was built and the other plugins, as npm installs them */
function pluginsWith(others: PluginFiles[]): string {
  const plugins = join(realpathSync(mkdtempSync(join(inject('e2eDirectory'), 'plugins-'))), 'node_modules');
  const mine = join(plugins, 'homebridge-fhemgate');
  mkdirSync(mine, { recursive: true });
  cpSync(join(root, 'dist'), join(mine, 'dist'), { recursive: true });
  cpSync(join(root, 'package.json'), join(mine, 'package.json'));
  // what the plugin needs, as fakegato-history
  symlinkSync(join(root, 'node_modules'), join(mine, 'node_modules'), 'dir');
  for (const other of others) {
    const directory = join(plugins, String(other.manifest.name));
    mkdirSync(directory);
    writeFileSync(join(directory, 'package.json'), JSON.stringify(other.manifest));
    writeFileSync(join(directory, 'index.js'), other.index);
  }
  return plugins;
}

/** the entry for homebridge-fhem as it was, with the platform name changed and migrateFrom added, as docs/migration.md says */
const movedEntry = (fhem: StandIn, migrateFrom: string | undefined) => ({
  platform: 'fhemgate',
  ...(migrateFrom === undefined ? {} : { migrateFrom }),
  name: 'FHEM',
  server: '127.0.0.1',
  port: fhem.fake.port,
  filter: 'room=HomeKit',
  auth: { user: 'homebridge', pass: 'secret' },
  jsFunctions: 'fhem-functions.js',
});

/** the accessories of fhem, without the one of the other plugin */
const ofFhem = (accessories: HapAccessory[]) => accessories.filter((accessory) => accessory.name !== 'Other');

/** the lines of the log of a homebridge that match */
const logged = (homebridge: Homebridge, pattern: RegExp) =>
  homebridge
    .output()
    .split('\n')
    .filter((line) => pattern.test(line));

describe.skipIf(realFhemUrl !== undefined)('a homebridge that ran homebridge-fhem and now starts with this plugin and migrateFrom', () => {
  const username = '0E:2E:2E:4D:00:01';
  let fhem: StandIn;
  let homebridge: Homebridge;
  let accessories: HapAccessory[];
  let world: World;
  let plugins: string;

  beforeAll(async () => {
    fhem = await startStandIn([...migrated.map((entry) => entry.device), elsewhere], { auth: { user: 'homebridge', pass: 'secret' } });
    plugins = pluginsWith([otherPlugin]);
    homebridge = await startHomebridge([movedEntry(fhem, 'FHEM'), { platform: 'e2e-other' }], {}, storageAfterHomebridgeFhem(username, 'FHEM'), {
      username,
      plugins,
    });
    accessories = ofFhem(await published(homebridge, migrated.length + 1));
    world = worldOf(fhem, homebridge, accessories, (name) => migrated.find((entry) => entry.device.Internals.NAME === name)?.name ?? name);
  });

  afterAll(async () => {
    await homebridge.stop();
    await fhem.close();
  });

  it('publishes the devices of the filter, under the names they had', () => {
    expect(accessories.map((accessory) => accessory.name).sort()).toEqual(migrated.map((entry) => entry.name).sort());
  });

  it('fetches the devices before homebridge publishes the bridge, which another plugin has an accessory on', () => {
    const output = homebridge.output();
    expect(output).toContain('migrateFrom: fetching the devices from fhem before homebridge publishes the bridge');
    expect(output.indexOf('migrateFrom: fetching the devices')).toBeLessThan(output.search(/Homebridge v.* is running on port/));
  });

  it('gives every accessory the id it had, so that HomeKit takes it for the accessory it knows', () => {
    expect(Object.fromEntries(accessories.map((accessory) => [accessory.name, accessory.aid]))).toEqual(
      Object.fromEntries(migrated.map((entry) => [entry.name, entry.aid])),
    );
  });

  it('finds every accessory in the file of homebridge under the uuid homebridge-fhem gave it', async () => {
    // homebridge writes the file again once it has published: what was not asked for is dropped from it
    await eventually('homebridge to keep the ids', () => (logged(homebridge, /Homebridge v.* is running on port/).length ? true : undefined), homebridge);

    expect(accessoryIds(homebridge.storage, username)).toMatchObject(idsBefore('FHEM'));
    // and the accessory of the other plugin
    expect(Object.keys(accessoryIds(homebridge.storage, username))).toHaveLength(migrated.length + 1);
  });

  it('keeps the id of a characteristic, which scenes and automations refer to', () => {
    expect(world.named('Wohnzimmer_Lampe', 'Switch', 'On')).toMatchObject({ aid: lamp.aid, iid: lampOn });
  });

  it('shows the serial numbers homebridge-fhem made the uuids from', () => {
    expect(Object.fromEntries(accessories.map((accessory) => [accessory.name, serialNumberOf(accessory)]))).toEqual(
      Object.fromEntries(migrated.map((entry) => [entry.name, entry.serial])),
    );
  });

  it('remembers every device as what it was published as, in a file of its own', () => {
    const [file] = storedFiles(homebridge, 'fhemgate-identities.json');

    expect(JSON.parse(readFileSync(file as string, 'utf8'))).toEqual({
      version: 1,
      // a serial number that a mapping gives is not remembered: the mapping says it on every start
      identities: Object.fromEntries<string | undefined>(
        migrated
          .filter((entry) => entry.serial !== 'POST-1')
          .map((entry) => [entry.device.Internals.FUUID as string, upstreamIdentity(entry.device).uuid_base]),
      ),
    });
  });

  it('loads the functions for mappings from the file in the storage directory', async () => {
    await eventually(
      'the light to be built from what fhem lists',
      async () => ((await homebridge.read(world.named('Regal', 'Lightbulb', 'Brightness'))) === 64 ? true : undefined),
      homebridge,
    );
  });

  it('finds the Eve history homebridge-fhem kept, with the openings it had counted', async () => {
    expect(world.characteristicsOf('Haustuer', eveType.History)).toContain(eveType.Reset);
    await eventually(
      'the history to be loaded',
      () => (logged(homebridge, /Haustuer: FakeGatoHistory extra persisted data loaded/).length ? true : undefined),
      homebridge,
    );

    expect(await homebridge.read(world.named('Haustuer', 'ContactSensor', 'TimesOpened'))).toBe(7);
    expect(storedFiles(homebridge, '_persist.json')).toHaveLength(1);
  });

  it('goes on writing that history', async () => {
    await homebridge.subscribe([world.named('Haustuer', 'ContactSensor', 'TimesOpened')]);

    await world.notifies(world.named('Haustuer', 'ContactSensor', 'TimesOpened'), 8, () => fhem.change('Haustuer', 'state', 'open'));

    const written = await eventually(
      'fakegato-history to write the opening',
      () => {
        try {
          const [file] = storedFiles(homebridge, '_persist.json');
          const stored = JSON.parse(readFileSync(file as string, 'utf8')) as typeof doorHistory;
          return stored.extra.TimesOpened === 8 && stored.history.length > doorHistory.history.length ? stored : undefined;
        } catch {
          // the file is being written
          return undefined;
        }
      },
      homebridge,
    );
    expect(written.initialTime).toBe(historyStart);
    expect(written.history.slice(0, doorHistory.history.length)).toEqual(doorHistory.history);
    expect(written.history.at(-1)).toMatchObject({ status: 1 });
  });

  it('has nothing to warn about', () => {
    expect(logged(homebridge, /homebridge-fhem is installed|config: |can not be read|no plugin serves|configured multiple times/)).toEqual([]);
  });

  it('keeps every accessory and its id on the next start, also while fhem can not be reached, and says they do not respond', async () => {
    await homebridge.stop();
    await fhem.close();

    homebridge = await startHomebridge([movedEntry(fhem, 'FHEM'), { platform: 'e2e-other' }], {}, homebridge.storage, { username, plugins });
    const again = ofFhem(await published(homebridge, migrated.length + 1));
    const restarted = worldOf(fhem, homebridge, again, (name) => migrated.find((entry) => entry.device.Internals.NAME === name)?.name ?? name);

    expect(Object.fromEntries(again.map((accessory) => [accessory.name, accessory.aid]))).toEqual(
      Object.fromEntries(migrated.map((entry) => [entry.name, entry.aid])),
    );
    expect(restarted.named('Wohnzimmer_Lampe', 'Switch', 'On')).toMatchObject({ aid: lamp.aid, iid: lampOn });
    expect(await homebridge.answer(restarted.named('Wohnzimmer_Lampe', 'Switch', 'On'))).toEqual({ value: undefined, status: -70402 });
    expect(logged(homebridge, /migrateFrom: fetching/)).toEqual([]);
    expect(logged(homebridge, /removing /)).toEqual([]);
  });
});

describe.skipIf(realFhemUrl !== undefined)('a homebridge that ran homebridge-fhem, configured with the plugin named', () => {
  const username = '0E:2E:2E:4D:00:02';
  // with the plugin named, homebridge made other uuids than for plain FHEM
  const platform = 'homebridge-fhem.FHEM';
  let fhem: StandIn;
  let homebridge: Homebridge;
  let accessories: HapAccessory[];

  beforeAll(async () => {
    fhem = await startStandIn([...migrated.map((entry) => entry.device), elsewhere], { auth: { user: 'homebridge', pass: 'secret' } });
    homebridge = await startHomebridge([movedEntry(fhem, platform), { platform: 'e2e-other' }], {}, storageAfterHomebridgeFhem(username, platform), {
      username,
      plugins: pluginsWith([otherPlugin]),
    });
    accessories = ofFhem(await published(homebridge, migrated.length + 1));
  });

  afterAll(async () => {
    await homebridge.stop();
    await fhem.close();
  });

  it('gives every accessory the id it had, from the uuids made with that name', async () => {
    expect(idsBefore(platform)).not.toEqual(idsBefore('FHEM'));
    expect(Object.fromEntries(accessories.map((accessory) => [accessory.name, accessory.aid]))).toEqual(
      Object.fromEntries(migrated.map((entry) => [entry.name, entry.aid])),
    );
    await eventually('homebridge to keep the ids', () => (logged(homebridge, /Homebridge v.* is running on port/).length ? true : undefined), homebridge);
    expect(accessoryIds(homebridge.storage, username)).toMatchObject(idsBefore(platform));
  });
});

describe.skipIf(realFhemUrl !== undefined)('a homebridge that ran homebridge-fhem and now starts with this plugin without migrateFrom', () => {
  const username = '0E:2E:2E:4D:00:03';
  let fhem: StandIn;
  let homebridge: Homebridge;
  let accessories: HapAccessory[];

  beforeAll(async () => {
    fhem = await startStandIn([...migrated.map((entry) => entry.device), elsewhere], { auth: { user: 'homebridge', pass: 'secret' } });
    homebridge = await startHomebridge([movedEntry(fhem, undefined), { platform: 'e2e-other' }], {}, storageAfterHomebridgeFhem(username, 'FHEM'), {
      username,
      plugins: pluginsWith([otherPlugin]),
    });
    accessories = ofFhem(await published(homebridge, migrated.length + 1));
  });

  afterAll(async () => {
    await homebridge.stop();
    await fhem.close();
  });

  it('publishes the accessories under the uuids homebridge-fhem gave them, but too late for homebridge to keep their ids on a bridge it shares', () => {
    expect(accessories.map((accessory) => accessory.name).sort()).toEqual(migrated.map((entry) => entry.name).sort());
    // which is what migrateFrom is for
    expect(accessories.map((accessory) => accessory.aid).filter((aid) => migrated.some((entry) => entry.aid === aid))).toEqual([]);
  });
});

describe.skipIf(realFhemUrl !== undefined)('a config.json that still has the entry of homebridge-fhem', () => {
  let fhem: StandIn;
  let homebridge: Homebridge;

  beforeAll(async () => {
    fhem = await startStandIn([lamp.device]);
    homebridge = await startHomebridge({ ...fhem.platformConfig, platform: 'FHEM' }, {}, undefined, { plugins: pluginsWith([]) });
    await eventually('homebridge to be up', () => homebridge.accessories(), homebridge, 60_000);
  });

  afterAll(async () => {
    await homebridge.stop();
    await fhem.close();
  });

  it('is told by the plugin what the entry has to say now', () => {
    expect(logged(homebridge, /^homebridge-fhemgate: /)).toEqual([
      'homebridge-fhemgate: config.json has a platform "FHEM", which no plugin serves: homebridge-fhemgate answers to "platform": "fhemgate". ' +
        'change the entry to "platform": "fhemgate", "migrateFrom": "FHEM", so that HomeKit keeps its accessories, see docs/migration.md.',
    ]);
  });
});

describe.skipIf(realFhemUrl !== undefined)('a homebridge that still has homebridge-fhem installed next to this plugin', () => {
  let fhem: StandIn;
  let homebridge: Homebridge;
  let plugins: string;

  beforeAll(async () => {
    plugins = pluginsWith([homebridgeFhem]);
    fhem = await startStandIn([lamp.device]);
    homebridge = await startHomebridge([fhem.platformConfig, { platform: 'FHEM' }], {}, undefined, { plugins });
    await eventually('homebridge to be up', () => homebridge.accessories(), homebridge, 60_000);
  });

  afterAll(async () => {
    await homebridge.stop();
    await fhem.close();
  });

  it('runs both, as each has a platform name of its own', async () => {
    expect(logged(homebridge, /registered multiple times|configured multiple times/)).toEqual([]);
    expect((await published(homebridge)).map((accessory) => accessory.name)).toEqual(['Stehlampe']);
  });

  it('is told by the plugin where homebridge-fhem is and what to do', () => {
    const lines = logged(homebridge, /^homebridge-fhemgate: /);

    expect(lines).toHaveLength(1);
    expect(lines[0]).toContain(`homebridge-fhem is installed as well, in ${join(plugins, 'homebridge-fhem')}, and both have a platform in config.json.`);
    expect(lines[0]).toContain('uninstall homebridge-fhem');
  });
});
