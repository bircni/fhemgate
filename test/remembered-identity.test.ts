// a device has to stay the same accessory for HomeKit from one start of homebridge to the next,
// also when what the plugin works its identity out from is not the same on every start
import { existsSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { device } from './support/devices.ts';
import { startFakeFhem, waitFor, type FakeFhem } from './support/fhemweb.ts';
import { characteristicOf, serviceOf } from './support/homekit.ts';
import { createWorld, hap, type World } from './support/subject.ts';
import type { Accessory, FhemDevice } from './support/types.ts';

const fuuid = '5f0d1e7a-f33f-1a2b-3c4d-0000000000aa';
const uniqueid = '00:17:88:01:02:03:04:05-0b';
const file = 'fhem2hb-identities.json';

let storage: string;
let fhem: FakeFhem | undefined;
let world: World;

/** a hue bulb, with the uniqueid it has once the bridge reported, or with the placeholder it has before */
const bulb = (id: string | undefined, attributes: Record<string, string> = {}): FhemDevice => ({
  Name: 'bulb',
  ...device({
    Internals: { NAME: 'bulb', TYPE: 'HUEDevice', FUUID: fuuid, ...(id ? { uniqueid: id } : {}) },
    Readings: { state: 'on', onoff: '1' },
    PossibleSets: 'on off',
    Attributes: attributes,
  }),
});

/** one start of homebridge: the accessories of a platform for what fhem lists */
async function start(devices: FhemDevice[]): Promise<Accessory[]> {
  await fhem?.close();
  fhem = await startFakeFhem({ devices });
  world = createWorld({ storagePath: storage });
  const platform = world.platform({ server: '127.0.0.1', port: fhem.port });
  await waitFor(() => world.csrfToken[`http://127.0.0.1:${fhem?.port}/fhem`] !== undefined, 'the platform to connect');
  return new Promise((resolve) => {
    platform.accessories(resolve);
  });
}

const identityOf = ([accessory]: Accessory[]) => ({ uuid_base: accessory?.uuid_base, serial: accessory?.serial });
const stored = () => JSON.parse(readFileSync(join(storage, file), 'utf8')) as unknown;

beforeEach(() => {
  storage = mkdtempSync(join(tmpdir(), 'fhem2hb-identity-'));
});

afterEach(async () => {
  // the plugin has no way to stop its long poll. faking the timers keeps it from reconnecting.
  vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
  await fhem?.close();
  fhem = undefined;
  await new Promise((resolve) => setImmediate(resolve));
  vi.useRealTimers();
  rmSync(storage, { recursive: true, force: true });
});

describe('the identity of a device', () => {
  it('stays the FUUID when the hue bridge had not reported on the first start and has on the next', async () => {
    expect(identityOf(await start([bulb('ff:ff:ff:ff:ff:ff:ff:ff-0b')]))).toEqual({ uuid_base: fuuid, serial: fuuid });

    expect(identityOf(await start([bulb(uniqueid)]))).toEqual({ uuid_base: fuuid, serial: fuuid });
  });

  it('stays the uniqueid when the hue bridge had reported on the first start and has not on the next', async () => {
    expect(identityOf(await start([bulb(uniqueid)]))).toEqual({ uuid_base: uniqueid, serial: uniqueid });

    expect(identityOf(await start([bulb(undefined)]))).toEqual({ uuid_base: uniqueid, serial: uniqueid });
    expect(identityOf(await start([bulb('ff:ff:ff:ff:ff:ff:ff:ff-0b')]))).toEqual({ uuid_base: uniqueid, serial: uniqueid });
  });

  it('is shown to HomeKit as the serial number', async () => {
    await start([bulb(uniqueid)]);
    const [accessory] = await start([bulb(undefined)]);

    const information = serviceOf(accessory?.getServices() ?? [], 'AccessoryInformation');
    expect(characteristicOf(information, hap.Characteristic.SerialNumber).value).toBe(uniqueid);
  });

  it('is kept in a file in the storage directory of homebridge, by the FUUID of the device', async () => {
    await start([bulb(uniqueid)]);

    expect(stored()).toEqual({ version: 1, identities: { [fuuid]: uniqueid } });
    expect(readdirSync(storage)).toEqual([file]);
  });

  it('follows a device that is renamed in fhem', async () => {
    await start([bulb(uniqueid)]);
    const renamed = bulb(undefined);
    renamed.Name = 'lampe';
    renamed.Internals.NAME = 'lampe';

    expect(identityOf(await start([renamed]))).toEqual({ uuid_base: uniqueid, serial: uniqueid });
  });

  it('is the serial number the user gives with a SerialNumber mapping, whatever is remembered, and the remembered one again without it', async () => {
    await start([bulb(uniqueid)]);

    expect(identityOf(await start([bulb(undefined, { homebridgeMapping: 'SerialNumber=serial=MINE-1' })]))).toEqual({ uuid_base: 'MINE-1', serial: 'MINE-1' });
    expect(stored()).toEqual({ version: 1, identities: { [fuuid]: uniqueid } });

    expect(identityOf(await start([bulb(undefined)]))).toEqual({ uuid_base: uniqueid, serial: uniqueid });
  });

  it('is worked out as before when there is no file yet, for every kind of device', async () => {
    const lamp = { Name: 'lamp', ...device({ Internals: { NAME: 'lamp', FUUID: 'fuuid-lamp' }, Readings: { state: 'on' }, PossibleSets: 'on off' }) };
    const fs20 = {
      Name: 'fs20',
      ...device({ Internals: { NAME: 'fs20', TYPE: 'FS20', DEF: '1234 56', FUUID: 'fuuid-fs20' }, Readings: { state: 'on' }, PossibleSets: 'on off' }),
    };

    const accessories = await start([fs20, lamp]);

    expect(accessories.map((accessory) => accessory.uuid_base)).toEqual(['FS20.1234 56', 'fuuid-lamp']);
    expect(stored()).toEqual({ version: 1, identities: { 'fuuid-fs20': 'FS20.1234 56', 'fuuid-lamp': 'fuuid-lamp' } });
  });
});

describe('the file with the identities', () => {
  it('is started anew, with a warning, when it is damaged', async () => {
    writeFileSync(join(storage, file), '{"version":1,"identities":{"5f0d');

    expect(identityOf(await start([bulb(uniqueid)]))).toEqual({ uuid_base: uniqueid, serial: uniqueid });

    expect(world.log.lines.filter((line) => line.startsWith('warn ') && line.includes(file))).toHaveLength(1);
    expect(world.log.errors()).toEqual([]);
    expect(stored()).toEqual({ version: 1, identities: { [fuuid]: uniqueid } });
  });

  it.each(['null', '[]', '{"identities":7}', '{"identities":{"' + fuuid + '":5}}'])('is taken for empty when it holds %s', async (content) => {
    writeFileSync(join(storage, file), content);

    expect(identityOf(await start([bulb(uniqueid)]))).toEqual({ uuid_base: uniqueid, serial: uniqueid });
    expect(stored()).toEqual({ version: 1, identities: { [fuuid]: uniqueid } });
  });

  it('does not stop the platform when it can not be written, which is reported once', async () => {
    rmSync(storage, { recursive: true, force: true });

    const accessories = await start([bulb(uniqueid)]);

    expect(identityOf(accessories)).toEqual({ uuid_base: uniqueid, serial: uniqueid });
    expect(world.log.lines.filter((line) => line.startsWith('warn ') && line.includes('can not be written'))).toHaveLength(1);
    expect(world.log.errors()).toEqual([]);
    expect(existsSync(storage)).toBe(false);
  });

  it('is not written again when nothing was added', async () => {
    await start([bulb(uniqueid)]);
    writeFileSync(join(storage, file), JSON.stringify({ version: 1, identities: { [fuuid]: uniqueid }, note: 'untouched' }));

    await start([bulb(undefined)]);

    expect(stored()).toHaveProperty('note', 'untouched');
  });
});
