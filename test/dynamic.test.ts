// the platform as homebridge runs it: homebridge restores the accessories it kept, tells the
// platform it is done, and the platform publishes what fhem lists. homebridge is played by a
// stand-in that records what it is asked to do.
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import * as hap from '@homebridge/hap-nodejs';
import type { API, Logging } from 'homebridge';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { PlatformAccessory } from '../node_modules/homebridge/dist/platformAccessory.js';
import { EveUUIDs } from '../src/accessory/customCharacteristics.ts';
import type { HistoryServiceClass } from '../src/accessory/history.ts';
import { FhemPlatform, MAX_BRIDGED_ACCESSORIES, REMOVAL_DELAY, type Plugin } from '../src/platform.ts';
import { PluginState } from '../src/state/pluginState.ts';
import { device } from './support/devices.ts';
import { startFakeFhem, waitFor, type FakeFhem } from './support/fhemweb.ts';
import { createLog, type CapturedLog } from './support/log.ts';
import type { FhemDevice } from './support/types.ts';

// the devices fetched before homebridge publishes the bridge come from a process of its own, which
// waits for a fhem that would have to answer from this one. the tests hand it the lists instead,
// unless they want it to try.
const fetched = vi.hoisted(() => ({ lists: undefined as unknown[] | undefined }));
vi.mock('../src/fhem/fetchNow.ts', async (importOriginal) => {
  const original = await importOriginal<typeof import('../src/fhem/fetchNow.ts')>();
  return {
    ...original,
    fetchDevicesNow: (...given: Parameters<typeof original.fetchDevicesNow>) =>
      (fetched.lists as ReturnType<typeof original.fetchDevicesNow> | undefined) ?? original.fetchDevicesNow(...given),
  };
});

/** stands in for the history service of fakegato-history, which needs a homebridge of its own */
class FakeHistory extends hap.Service {
  extra_persist = {};
  constructor() {
    super('History', 'E863F007-079E-48FF-8F27-9C2605A29F52');
  }
  isHistoryLoaded = () => true;
  getExtraPersistedData = () => ({ reset: 5 });
  setExtraPersistedData = () => undefined;
  addEntry = () => undefined;
  getInitialTime = () => undefined;
  save = () => undefined;
}

/** the history service class the next platform gets, none as if fakegato-history was not installed */
let historyClass: HistoryServiceClass | undefined;

let storage: string;
let fhem: FakeFhem | undefined;
let log: CapturedLog;

const lamp = (name: string, fuuid = 'fuuid-' + name): FhemDevice => ({
  Name: name,
  ...device({ Internals: { NAME: name, FUUID: fuuid }, Readings: { state: 'on' }, PossibleSets: 'on off' }),
});

/** homebridge, as far as the platform deals with it */
function homebridge() {
  let finished: (() => void) | undefined;
  const accessories = new Map<string, PlatformAccessory>();
  const api = {
    hap,
    version: 2.7,
    user: { storagePath: () => storage, configPath: () => join(storage, 'config.json') },
    platformAccessory: PlatformAccessory,
    on: (event: string, handler: () => void) => {
      if (event === 'didFinishLaunching') {
        finished = handler;
      }
    },
    registerPlatformAccessories: vi.fn((_plugin: string, _platform: string, added: PlatformAccessory[]) => {
      for (const accessory of added) {
        accessories.set(accessory.UUID, accessory);
      }
    }),
    updatePlatformAccessories: vi.fn(),
    unregisterPlatformAccessories: vi.fn((_plugin: string, _platform: string, removed: PlatformAccessory[]) => {
      for (const accessory of removed) {
        accessories.delete(accessory.UUID);
      }
    }),
  };
  return { api, accessories, launch: () => finished?.() };
}

type Homebridge = ReturnType<typeof homebridge>;

/** a platform for the fhem, with what homebridge kept from before restored */
function platform(bridge: Homebridge, config: Record<string, unknown> = {}, restored: PlatformAccessory[] = []): FhemPlatform {
  const plugin: Plugin = { state: new PluginState(hap), storagePath: () => storage, debugServers: new Map() };
  plugin.state.historyServiceClass = historyClass;
  const created = new FhemPlatform(
    log as unknown as Logging,
    { platform: 'fhemgate', debugPort: false, server: '127.0.0.1', port: fhem?.port, ...config },
    bridge.api as unknown as API,
    plugin,
  );
  for (const accessory of restored) {
    created.configureAccessory(accessory);
  }
  return created;
}

/** a fhem with the devices, and a homebridge that has started and published the accessory of each */
async function launched(devices: FhemDevice[]): Promise<Homebridge> {
  fhem = await startFakeFhem({ devices });
  const bridge = homebridge();
  platform(bridge);
  bridge.launch();
  await waitFor(() => bridge.accessories.size === devices.length, 'the accessories to be registered');
  return bridge;
}

/**
 * Has fhem list the devices from now on, ends its long poll and waits until fhem was asked for
 * them again. Timers have to be faked.
 *
 * @param round how often this was done before in the test
 */
async function relist(devices: FhemDevice[], round: number): Promise<void> {
  const stream = fhem as FakeFhem;
  stream.options.devices = devices;
  stream.endStreams();
  await waitFor(() => log.lines.filter((line) => line.includes('longpoll ended')).length > round, 'the long poll to end');
  vi.advanceTimersByTime(5000);
  await waitFor(() => log.lines.filter((line) => line.includes('got: ')).length > round + 1, 'fhem to be asked');
}

/** what homebridge keeps of an accessory and restores on its next start */
function kept(accessory: PlatformAccessory): PlatformAccessory {
  Object.assign(accessory, { _associatedPlugin: 'homebridge-fhemgate', _associatedPlatform: 'fhemgate' });
  return PlatformAccessory.deserialize(PlatformAccessory.serialize(accessory));
}

/** the answer HomeKit gets for a read: the value, or the status of the error */
const read = (characteristic: hap.Characteristic): Promise<unknown> =>
  characteristic.handleGetRequest().then(
    (value) => value,
    (error: unknown) => (typeof error === 'number' ? error : (error as { hapStatus?: number }).hapStatus),
  );

const switchOf = (accessory: PlatformAccessory | undefined): hap.Characteristic =>
  accessory?.getService(hap.Service.Switch)?.getCharacteristic(hap.Characteristic.On) as hap.Characteristic;

beforeEach(() => {
  fetched.lists = undefined;
  historyClass = undefined;
  storage = mkdtempSync(join(tmpdir(), 'fhemgate-dynamic-'));
  log = createLog();
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

describe('a dynamic platform', () => {
  it('publishes what fhem lists under the uuids homebridge-fhem gave the devices, once homebridge restored what it kept', async () => {
    fhem = await startFakeFhem({ devices: [lamp('lamp_a'), lamp('lamp_b')] });
    const bridge = homebridge();
    platform(bridge);
    expect(fhem.requests).toHaveLength(0);

    bridge.launch();
    await waitFor(() => bridge.accessories.size === 2, 'the accessories to be registered');

    expect([...bridge.accessories.keys()]).toEqual([hap.uuid.generate('FHEM:fuuid-lamp_a'), hap.uuid.generate('FHEM:fuuid-lamp_b')]);
    expect([...bridge.accessories.values()].map((accessory) => accessory.displayName)).toEqual(['lamp-a', 'lamp-b']);
    expect(bridge.api.registerPlatformAccessories).toHaveBeenCalledWith('homebridge-fhemgate', 'fhemgate', expect.any(Array));
    expect(bridge.accessories.get(hap.uuid.generate('FHEM:fuuid-lamp_a'))?.context).toEqual({
      device: 'lamp_a',
      fuuid: 'fuuid-lamp_a',
      server: 0,
      uuidPrefix: 'FHEM',
    });
  });

  it('builds the accessories homebridge restored again, keeping the ids HomeKit knows them by', async () => {
    const first = await launched([lamp('lamp_a')]);
    const before = [...first.accessories.values()][0] as PlatformAccessory;
    await (fhem as FakeFhem).close();

    fhem = await startFakeFhem({ devices: [lamp('lamp_a')] });
    const restored = kept(before);
    // the ids the bridge gives the accessory from its own cache when it publishes it, before fhem answers
    (restored.getService(hap.Service.Switch) as hap.Service).iid = 9;
    switchOf(restored).iid = 10;
    const second = homebridge();
    platform(second, {}, [restored]);
    second.launch();
    await waitFor(
      () => second.api.updatePlatformAccessories.mock.calls.some(([updated]) => (updated as unknown[]).length === 1),
      'the accessory to be updated',
    );

    expect(second.api.registerPlatformAccessories).not.toHaveBeenCalled();
    expect(restored.getService(hap.Service.Switch)?.iid).toBe(9);
    expect(switchOf(restored).iid).toBe(10);
    expect(await read(switchOf(restored))).toBe(true);
  });

  it('answers that a restored accessory does not respond until fhem listed its device', async () => {
    fhem = await startFakeFhem({ devices: [lamp('lamp_a')], holds: (cmd) => cmd === 'jsonlist2' });
    const first = homebridge();
    const accessory = new PlatformAccessory('lamp-a', hap.uuid.generate('FHEM:fuuid-lamp_a'));
    accessory.addService(hap.Service.Switch, 'lamp_a');
    const restored = kept(accessory);
    platform(first, {}, [restored]);

    expect(await read(switchOf(restored))).toBe(hap.HAPStatus.SERVICE_COMMUNICATION_FAILURE);
    await expect(switchOf(restored).handleSetRequest(true)).rejects.toBeDefined();
  });

  it('answers that a device does not respond while fhem can not be reached', async () => {
    const bridge = await launched([lamp('lamp_a')]);
    const accessory = [...bridge.accessories.values()][0];
    expect(await read(switchOf(accessory))).toBe(true);

    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
    await (fhem as FakeFhem).close();
    await waitFor(() => log.lines.some((line) => /longpoll (ended|error)/.test(line)), 'the long poll to end');

    expect(await read(switchOf(accessory))).toBe(hap.HAPStatus.SERVICE_COMMUNICATION_FAILURE);
    await expect(switchOf(accessory).handleSetRequest(false)).rejects.toBe(hap.HAPStatus.SERVICE_COMMUNICATION_FAILURE);
    expect(bridge.api.unregisterPlatformAccessories).not.toHaveBeenCalled();
  });

  it('removes the accessory of a device fhem no longer lists, once it is still gone ten minutes later', async () => {
    const bridge = await launched([lamp('lamp_a'), lamp('lamp_b')]);

    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'Date'] });
    await relist([lamp('lamp_a')], 0);
    await waitFor(() => log.lines.some((line) => line.includes('lamp-b is no longer published by fhem')), 'the device to be missed');
    expect(bridge.accessories.size).toBe(2);

    vi.advanceTimersByTime(REMOVAL_DELAY + 1000);
    await waitFor(() => bridge.accessories.size === 1, 'the accessory to be removed');

    expect([...bridge.accessories.values()].map((accessory) => accessory.displayName)).toEqual(['lamp-a']);
    expect(log.lines).toContain('info removing lamp-b, which fhem no longer publishes');
  });

  it('keeps the accessory of a device fhem lists but no accessory could be made of', async () => {
    const bridge = await launched([lamp('lamp_a'), lamp('lamp_b')]);

    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'Date'] });
    const broken = lamp('lamp_b');
    delete (broken as Partial<FhemDevice>).Readings;
    for (let round = 0; round < 2; round++) {
      await relist([lamp('lamp_a'), broken], round);
      vi.advanceTimersByTime(REMOVAL_DELAY + 5000);
    }

    expect(bridge.accessories.size).toBe(2);
    expect(log.lines.filter((line) => line.includes('no longer published'))).toEqual([]);
    // what it showed before is no more than a guess now
    expect(await read(switchOf([...bridge.accessories.values()][1]))).toBe(hap.HAPStatus.SERVICE_COMMUNICATION_FAILURE);
    expect(await read(switchOf([...bridge.accessories.values()][0]))).toBe(true);
  });

  it('removes the accessory of a device that is gone in time, also while the one of another is due already', async () => {
    const bridge = await launched([lamp('lamp_a'), lamp('lamp_b'), lamp('lamp_c')]);

    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'Date'] });
    await relist([lamp('lamp_a'), lamp('lamp_b')], 0);
    vi.advanceTimersByTime(REMOVAL_DELAY / 2);
    await relist([lamp('lamp_a')], 1);

    vi.advanceTimersByTime(REMOVAL_DELAY / 2);
    await waitFor(() => bridge.accessories.size === 2, 'the first accessory to be removed');
    // the second went missing five minutes and some seconds of listing later
    vi.advanceTimersByTime(REMOVAL_DELAY / 2 + 20_000);
    await waitFor(() => bridge.accessories.size === 1, 'the second accessory to be removed');

    expect([...bridge.accessories.values()].map((accessory) => accessory.displayName)).toEqual(['lamp-a']);
  });

  it('publishes nothing from a second platform in the same homebridge, and says what to do', async () => {
    const bridge = await launched([lamp('lamp_a')]);
    const plugin: Plugin = { state: new PluginState(hap), storagePath: () => storage, debugServers: new Map(), platformCreated: true };

    const second = new FhemPlatform(
      log as unknown as Logging,
      { platform: 'fhemgate', debugPort: false, server: '127.0.0.1' },
      bridge.api as unknown as API,
      plugin,
    );

    expect(second.servers).toEqual([]);
    expect(log.errors()).toContain(
      'error there is another fhemgate platform on this bridge. this one publishes nothing: merge them into one entry with connections, see docs/configuration.md.',
    );
  });

  it('keeps the Eve history of a device working through a listing that leaves the device out', async () => {
    const door = (readings: boolean): FhemDevice => {
      const d = lamp('door');
      d.Attributes = {
        genericDeviceType: 'ContactSensor',
        homebridgeMapping: 'ContactSensorState=state,values=closed:CONTACT_DETECTED;open:CONTACT_NOT_DETECTED history=size=16',
      };
      d.Readings = readings ? { state: { Value: 'closed', Time: '2026-11-20 10:00:00' } } : (undefined as never);
      return d;
    };
    historyClass = FakeHistory as unknown as HistoryServiceClass;
    const bridge = await launched([door(true)]);
    // the reset of the history, which Eve reads
    const reset = () =>
      [...bridge.accessories.values()][0]?.services
        .find((service) => service.UUID === 'E863F007-079E-48FF-8F27-9C2605A29F52')
        ?.characteristics.find((each) => each.UUID === EveUUIDs.Reset) as hap.Characteristic;
    expect(await read(reset())).toBe(5);

    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'Date'] });
    await relist([door(false)], 0);
    await relist([door(true)], 1);

    expect(await read(reset())).toBe(5);
  });

  it('says so when homebridge kept accessories that were made with another migrateFrom', () => {
    const bridge = homebridge();
    const accessory = new PlatformAccessory('lamp-a', hap.uuid.generate('homebridge-fhem.FHEM:fuuid-lamp_a'));
    accessory.context = { uuidPrefix: 'homebridge-fhem.FHEM' };
    platform(bridge, { port: 1 }, [kept(accessory)]);

    bridge.launch();

    expect(log.lines).toContain(
      'warn 1 accessories homebridge kept were made with migrateFrom "homebridge-fhem.FHEM". they are not published again and stay without response: set migrateFrom back, or remove them in the Homebridge UI.',
    );
  });

  it(`publishes no more than the ${MAX_BRIDGED_ACCESSORIES} accessories a HomeKit bridge takes, and says what to do`, async () => {
    const devices = Array.from({ length: MAX_BRIDGED_ACCESSORIES + 1 }, (_, index) => lamp(`lamp_${String(index).padStart(3, '0')}`));
    fhem = await startFakeFhem({ devices });
    const bridge = homebridge();
    platform(bridge);
    bridge.launch();
    await waitFor(() => bridge.accessories.size === MAX_BRIDGED_ACCESSORIES, 'the accessories to be registered');

    expect(log.lines.filter((line) => line.startsWith('warn ') && !line.includes('siri'))).toEqual([
      'warn 1 devices are not published: a HomeKit bridge takes 149 accessories at most, and HomeKit refuses a bridge with more. ' +
        'narrow the filter, or split the devices over several fhemgate platforms with different filters and run each as a child bridge.',
    ]);
    expect(log.errors()).toEqual(['error lamp-149 is not published: the bridge has 149 accessories, which is all a HomeKit bridge takes']);
  });

  it('makes the uuids with the platform name of migrateFrom, and publishes them before homebridge publishes the bridge', async () => {
    fhem = await startFakeFhem({ devices: [lamp('lamp_a')], holds: (cmd) => cmd === 'jsonlist2' });
    fetched.lists = [[lamp('lamp_a')]];
    const bridge = homebridge();
    platform(bridge, { migrateFrom: 'homebridge-fhem.FHEM' });

    bridge.launch();

    expect([...bridge.accessories.keys()]).toEqual([hap.uuid.generate('homebridge-fhem.FHEM:fuuid-lamp_a')]);
    expect(log.lines).toContain('info migrateFrom: fetching the devices from fhem before homebridge publishes the bridge');
    // until fhem has listed the devices itself, what was fetched for homebridge sends nothing
    expect(await read(switchOf([...bridge.accessories.values()][0]))).toBe(hap.HAPStatus.SERVICE_COMMUNICATION_FAILURE);
  });

  it('does not fetch the devices before homebridge publishes the bridge when homebridge restored accessories', async () => {
    fhem = await startFakeFhem({ devices: [lamp('lamp_a')] });
    const bridge = homebridge();
    const accessory = new PlatformAccessory('lamp-a', hap.uuid.generate('FHEM:fuuid-lamp_a'));
    platform(bridge, { migrateFrom: 'FHEM' }, [kept(accessory)]);

    bridge.launch();

    expect(log.lines.filter((line) => line.includes('migrateFrom'))).toEqual([]);
  });

  // the process that fetches the devices is run for real only by the end-to-end test in migration.e2e.ts:
  // here it would wait for a fhem that answers from this very process
  it('goes on when fhem can not be reached before homebridge publishes the bridge, and says what that means', () => {
    const bridge = homebridge();
    platform(bridge, { migrateFrom: 'FHEM', port: 1 });

    bridge.launch();

    expect(bridge.accessories.size).toBe(0);
    expect(log.errors()).toContain(
      'error migrateFrom: fhem could not be asked for its devices before homebridge publishes the bridge. HomeKit takes the accessories of http://127.0.0.1:1/fhem for new ones.',
    );
  });
});
