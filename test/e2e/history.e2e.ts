// the Eve history, kept by the real fakegato-history package: homebridge has it installed here.
//
// the devices are dummy devices, so the same test runs against the stand-in and against a real
// fhem (set E2E_FHEM_URL).
import { readFileSync } from 'node:fs';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { DummyDevice } from './fhem.ts';
import { eveType, hapType, startHomebridge, storedFiles, type TypeName } from './homebridge.ts';
import { eventually, published, servicesByName, startWorld, worldOf, type World } from './world.ts';

const devices: DummyDevice[] = [
  {
    name: 'e2e_h_door',
    readings: { state: 'closed' },
    attributes: {
      genericDeviceType: 'ContactSensor',
      homebridgeMapping: 'ContactSensorState=state,values=closed:CONTACT_DETECTED;open:CONTACT_NOT_DETECTED history=size=2048',
    },
  },
  {
    name: 'e2e_h_heating',
    setList: 'desired-temp:slider,5,0.5,30',
    readingList: 'desired-temp',
    readings: { state: 'ok', 'desired-temp': '21', temperature: '19.5', actuator: '40' },
    attributes: { homebridgeMapping: 'history=size=1024' },
  },
  {
    name: 'e2e_h_climate',
    readings: { state: 'ok', temperature: '21.3', humidity: '55', pressure: '1013' },
    attributes: { homebridgeMapping: 'history=size=1024' },
  },
  {
    name: 'e2e_h_motion',
    readings: { state: 'ok', motion: 'off' },
    attributes: { genericDeviceType: 'MotionSensor', homebridgeMapping: 'MotionDetected=motion,valueOn=on history=size=1024' },
  },
  { name: 'e2e_h_air', readings: { state: 'ok', co2: '900' }, attributes: { homebridgeMapping: 'history=size=1024' } },
  // there is no kind of history for a switch, so the mapping has to name one. a second history is refused.
  {
    name: 'e2e_h_plug',
    setList: 'on off',
    readings: { state: 'on', power: '45' },
    attributes: { homebridgeMapping: 'history=type=energy history=size=10' },
  },
  { name: 'e2e_h_switch', setList: 'on off', readings: { state: 'on' }, attributes: { homebridgeMapping: 'history=size=1024' } },
];

/** what fakegato-history writes into the storage directory of homebridge for an accessory */
interface PersistedHistory {
  history: (string | { time: number; status?: number; setTemp?: number; currentTemp?: number; valvePosition?: number })[];
  extra?: { TimesOpened?: number; LastActivation?: number; reset?: number };
}

let world: World;

beforeAll(async () => {
  world = await startWorld(devices, { room: 'e2e_history' });
});

afterAll(async () => {
  await world.close();
});

/** the lines of the log of homebridge that match */
const logged = (pattern: RegExp) =>
  world.homebridge
    .output()
    .split('\n')
    .filter((line) => pattern.test(line));

/** the histories fakegato-history has written so far */
const persisted = (): PersistedHistory[] =>
  storedFiles(world.homebridge, '_persist.json').map((file) => JSON.parse(readFileSync(file, 'utf8')) as PersistedHistory);

/** the entries of the persisted history that has an entry like the wanted one, once there is one */
const persistedWith = (wanted: Record<string, number>, isIt: (file: PersistedHistory) => boolean = () => true) =>
  eventually(
    `fakegato-history to write an entry like ${JSON.stringify(wanted)}`,
    () => {
      try {
        return persisted().find(
          (file) =>
            isIt(file) &&
            file.history.some((entry) => typeof entry === 'object' && Object.entries(wanted).every(([key, value]) => entry[key as 'time'] === value)),
        );
      } catch {
        // the file is being written
        return undefined;
      }
    },
    world.homebridge,
  );

// only the history of a door counts openings
const ofDoor = (file: PersistedHistory) => file.extra?.TimesOpened !== undefined;
const ofMotionSensor = (file: PersistedHistory) => file.extra !== undefined && !ofDoor(file);

const door = (type: TypeName) => world.named('e2e_h_door', 'ContactSensor', type);

describe('a device with a history mapping', () => {
  it('gets the history service of Eve next to its own, if there is a kind of history for it', () => {
    expect(servicesByName(world.accessories)).toEqual({
      e2e_h_door: [hapType.ContactSensor, eveType.History],
      e2e_h_heating: [hapType.Thermostat, eveType.History],
      e2e_h_climate: [hapType.TemperatureSensor, eveType.History],
      e2e_h_motion: [hapType.MotionSensor, eveType.History],
      e2e_h_air: [hapType.AirQualitySensor, eveType.History],
      e2e_h_plug: [hapType.Switch, eveType.History],
      e2e_h_switch: [hapType.Switch],
    });
    expect(logged(/e2e-h-switch: history: no type known for Switch/)).toHaveLength(1);
  });

  it.each([
    ['e2e-h-door', 'door', 'ContactSensor'],
    ['e2e-h-heating', 'thermo', 'Thermostat'],
    ['e2e-h-climate', 'weather', 'TemperatureSensor'],
    ['e2e-h-motion', 'motion', 'MotionSensor'],
    ['e2e-h-air', 'room', 'AirQualitySensor'],
    // named by the mapping
    ['e2e-h-plug', 'energy', 'Switch'],
  ])('keeps for %s the %s history', (_accessory, type, service) => {
    expect(logged(new RegExp(`FakeGatoHistory service with type ${type} for ${service}$`))).toHaveLength(1);
  });

  it('gets only one history', () => {
    expect(logged(/e2e-h-plug: FakeGatoHistory already created/)).toHaveLength(1);
  });

  it('gets the counters Eve shows for a door, and the characteristic that resets them', () => {
    expect(world.characteristicsOf('e2e_h_door', hapType.ContactSensor)).toEqual([
      hapType.ContactSensorState,
      eveType.TimesOpened,
      eveType.LastActivation,
      eveType.OpenDuration,
      eveType.ClosedDuration,
    ]);
    expect(world.characteristicsOf('e2e_h_door', eveType.History)).toContain(eveType.Reset);
    expect(world.characteristicsOf('e2e_h_motion', hapType.MotionSensor)).toEqual([hapType.MotionDetected, eveType.LastActivation]);
    expect(door('TimesOpened')).toMatchObject({ value: 0, format: 'uint32', perms: ['pr', 'ev'] });
    expect(door('OpenDuration').value).toBe(0);
    expect(door('ClosedDuration').value).toBe(0);
  });
});

describe('a reading that changes in fhem', () => {
  it('is written to the history of a door, which counts how often it was opened', async () => {
    // the history counts in seconds. the door is opened in a later one than the history started in.
    await new Promise((resolve) => setTimeout(resolve, 1100));
    await world.notifies(door('TimesOpened'), 1, () => world.fhem.change('e2e_h_door', 'state', 'open'));
    await world.notifies(door('ContactSensorState'), 0, () => world.fhem.change('e2e_h_door', 'state', 'closed'));
    await world.notifies(door('TimesOpened'), 2, () => world.fhem.change('e2e_h_door', 'state', 'open'));

    const { history, extra } = await persistedWith({ status: 0 }, (file) => file.extra?.TimesOpened === 2);
    // closed, as the door was when the history started, and then open, closed and open
    expect(history.slice(2).map((entry) => (typeof entry === 'object' ? entry.status : entry))).toEqual([0, 1, 0, 1]);
    expect(extra?.TimesOpened).toBe(2);
    expect(await world.homebridge.read(door('TimesOpened'))).toBe(2);
  });

  it('moves the last activation of the door to the second of its last change, counted from the start of the history', async () => {
    const seconds = Number(await world.homebridge.read(door('LastActivation')));

    expect(seconds).toBeGreaterThanOrEqual(1);
    expect(seconds).toBeLessThan(60);
  });

  it('is written to the history of a thermostat with what it is set to and how far its valve is open', async () => {
    await world.fhem.change('e2e_h_heating', 'temperature', '20');

    const { history } = await persistedWith({ currentTemp: 20 });
    expect(history.at(-1)).toMatchObject({ setTemp: 21, currentTemp: 20, valvePosition: 40 });
  });

  it('is written to the history of a motion sensor', async () => {
    await world.notifies(world.named('e2e_h_motion', 'MotionSensor', 'MotionDetected'), 1, () => world.fhem.change('e2e_h_motion', 'motion', 'on'));

    const { history, extra } = await persistedWith({ status: 1 }, ofMotionSensor);
    expect(history.at(-1)).toMatchObject({ status: 1 });
    expect(extra).toMatchObject({ LastActivation: 0 });
  });

  // fakegato-history keeps these to write their average every ten minutes, so they are looked for in the log
  it.each([
    ['e2e_h_climate', 'temperature', '20', /adding history entry \{ time: \d+, temp: 20 \}/],
    ['e2e_h_climate', 'humidity', '60', /adding history entry \{ time: \d+, humidity: 60 \}/],
    ['e2e_h_climate', 'pressure', '990', /adding history entry \{ time: \d+, pressure: 990 \}/],
    // the concentration, not the level of the air quality that is shown for it
    ['e2e_h_air', 'co2', '1600', /adding history entry \{ time: \d+, ppm: 1600 \}/],
    ['e2e_h_plug', 'power', '100', /adding history entry \{ time: \d+, power: 100 \}/],
  ])('%s %s = %s is handed to the history', async (device, reading, value, entry) => {
    await world.fhem.change(device, reading, value);

    await eventually('the plugin to add the entry', () => (logged(entry).length ? true : undefined), world.homebridge);
  });

  it('is not handed to the history when it is a concentration that is no number', async () => {
    const entries = () => logged(/adding history entry \{ time: \d+, ppm: /).length;
    const before = entries();

    // HomeKit is told that the quality of the air is not known
    await world.notifies(world.named('e2e_h_air', 'AirQualitySensor', 'AirQuality'), 0, () => world.fhem.change('e2e_h_air', 'co2', 'n/a'));

    expect(entries()).toBe(before);
  });
});

describe('homebridge starting again', () => {
  it('finds the history and the count of openings it had written', async () => {
    const { fhem, homebridge: first } = world;
    // homebridge tells the plugin that it ends, and the plugin writes the histories
    await first.stop({ untilExited: true });

    const again = await startHomebridge(fhem.platformConfig, {}, first.storage);
    world = worldOf(fhem, again, await published(again, devices.length), (device) => device);
    await again.subscribe([door('TimesOpened')]);

    expect(logged(/e2e-h-door: FakeGatoHistory extra persisted data loaded/)).toHaveLength(1);
    expect(await again.read(door('TimesOpened'))).toBe(2);
    const { history } = await persistedWith({ status: 0 }, ofDoor);
    expect(history.filter((entry) => typeof entry === 'object' && entry.status === 1)).toHaveLength(2);
  });

  it('starts the count of openings again when Eve resets it', async () => {
    const reset = world.characteristic('e2e_h_door', eveType.History, eveType.Reset);

    await world.notifies(door('TimesOpened'), 0, () => world.homebridge.write(reset, 5));

    expect(await world.homebridge.read(reset)).toBe(5);
  });
});
