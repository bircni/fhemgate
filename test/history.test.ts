// the eve history kept through fakegato-history
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { describeService } from './support/describe.ts';
import { device } from './support/devices.ts';
import { characteristicOf, read, serviceOf, write } from './support/homekit.ts';
import { createWorld, customUUIDs, hap } from './support/subject.ts';

/** stands in for the history service of fakegato-history and records what the plugin does with it */
class FakeHistory extends hap.Service {
  static instances: FakeHistory[] = [];
  static loaded = true;
  static initialTime: number | undefined = 1786881000;
  static persisted: Record<string, number> | undefined = { TimesOpened: 3, LastActivation: 0, OpenDuration: 0, ClosedDuration: 0, reset: 0 };

  entries: unknown[] = [];
  saved = 0;
  extra: unknown;

  constructor(
    readonly type: string,
    readonly accessory: unknown,
    readonly options: unknown,
  ) {
    super('History', 'E863F007-079E-48FF-8F27-9C2605A29F52');
    FakeHistory.instances.push(this);
  }

  isHistoryLoaded = () => FakeHistory.loaded;
  getExtraPersistedData = () => FakeHistory.persisted;
  setExtraPersistedData = (extra: unknown) => {
    this.extra = extra;
  };

  addEntry = (entry: unknown) => {
    this.entries.push(entry);
  };

  getInitialTime = () => FakeHistory.initialTime;
  save = () => {
    this.saved++;
  };
}

const world = () => createWorld({ fakeGato: FakeHistory });

/** a door contact that follows the reading, which the device has as closed */
const contact = (mapping = '', reading = 'state') =>
  device({
    Internals: { NAME: 'door' },
    Readings: { state: 'closed' },
    Attributes: {
      genericDeviceType: 'ContactSensor',
      homebridgeMapping: `ContactSensorState=${reading},values=closed:CONTACT_DETECTED;/.*/:CONTACT_NOT_DETECTED history=size=2048 ${mapping}`,
    },
  });

beforeEach(() => {
  vi.useFakeTimers({ now: new Date('2026-08-16T12:10:00Z') });
  FakeHistory.instances = [];
  FakeHistory.loaded = true;
  FakeHistory.initialTime = 1786881000;
  FakeHistory.persisted = { TimesOpened: 3, LastActivation: 0, OpenDuration: 0, ClosedDuration: 0, reset: 0 };
});

afterEach(() => {
  vi.useRealTimers();
});

describe('a contact sensor with history', () => {
  it('gets a history service and the eve characteristics', () => {
    const accessory = world().accessory(contact());

    const services = accessory.getServices();

    expect(services.map(describeService)).toMatchSnapshot();
    expect(FakeHistory.instances).toHaveLength(1);
    expect(FakeHistory.instances[0]?.type).toBe('door');
    expect(FakeHistory.instances[0]?.accessory).toBe(accessory);
    expect(FakeHistory.instances[0]?.options).toEqual({ size: '2048', storage: 'fs' });
  });

  it('takes over the number of times it was opened from the persisted history', () => {
    const w = world();
    w.accessory(contact()).getServices();

    expect(w.cached['door-EVE-TimesOpened']).toBe(3);
    expect(w.log.debugLines).toContain('door: FakeGatoHistory extra persisted data loaded');
  });

  it('adds an entry and counts when it is opened', async () => {
    const w = world();
    const services = w.accessory(contact()).getServices();
    const history = FakeHistory.instances[0];

    w.update('door-state', 'open');
    await vi.advanceTimersByTimeAsync(0);

    expect(history?.entries).toEqual([{ time: 1786882200, status: 1 }]);
    expect(w.cached['door-EVE-TimesOpened']).toBe(4);
    expect(characteristicOf(serviceOf(services, 'ContactSensor'), 'TimesOpened').value).toBe(4);

    w.update('door-state', 'closed');
    expect(history?.entries).toEqual([
      { time: 1786882200, status: 1 },
      { time: 1786882200, status: 0 },
    ]);
    expect(w.cached['door-EVE-TimesOpened']).toBe(4);
  });

  it('answers the eve characteristics', () => {
    const w = world();
    const sensor = serviceOf(w.accessory(contact()).getServices(), 'ContactSensor');

    expect(read(characteristicOf(sensor, 'TimesOpened'))).toEqual({ error: null, value: 3, answered: true });
    expect(read(characteristicOf(sensor, 'OpenDuration'))).toEqual({ error: null, value: 0, answered: true });
    expect(read(characteristicOf(sensor, 'ClosedDuration'))).toEqual({ error: null, value: 0, answered: true });
  });

  it('answers the seconds from the start of the history to the last change of the contact', () => {
    const w = world();
    const sensor = serviceOf(w.accessory(contact()).getServices(), 'ContactSensor');

    // the reading is from 12:00:00, the history starts 600 seconds before that
    expect(read(characteristicOf(sensor, 'LastActivation'))).toEqual({ error: null, value: 600, answered: true });
  });

  it('reads the eve characteristics from the contact, whatever mappings follow it', () => {
    const w = world();
    const door = contact('Switch#On=licht,cmdOn=an,cmdOff=aus');
    door.Readings.state = { Value: 'closed', Time: '2026-08-16 12:00:00' };
    door.Readings.licht = { Value: 'on', Time: '2026-08-16 12:05:00' };
    const services = w.accessory(door).getServices();
    const sensor = serviceOf(services, 'ContactSensor');

    // on the service of the contact, not on the switch that came last
    expect(serviceOf(services, 'Switch').characteristics.map((characteristic) => characteristic.displayName)).toEqual(['Name', 'On']);
    expect(read(characteristicOf(sensor, 'LastActivation'))).toEqual({ error: null, value: 600, answered: true });
    expect(w.log.debugLines).toContain('    Custom LastActivation characteristic door:state');
    expect(w.log.debugLines).toContain('query Custom LastActivation for door:state: 600');
  });

  it('starts the history with the current state when it is empty, and answers 0 as the last activation', () => {
    FakeHistory.initialTime = undefined;
    const w = world();
    const sensor = serviceOf(w.accessory(contact()).getServices(), 'ContactSensor');

    const result = read(characteristicOf(sensor, 'LastActivation'));

    expect(FakeHistory.instances[0]?.entries).toEqual([{ time: 1786881600, status: 0 }]);
    expect(result).toEqual({ error: null, value: 0, answered: true });
  });

  it('starts no history while the one on disk is still being read', () => {
    FakeHistory.initialTime = undefined;
    FakeHistory.loaded = false;
    const w = world();
    const sensor = serviceOf(w.accessory(contact()).getServices(), 'ContactSensor');

    expect(read(characteristicOf(sensor, 'LastActivation'))).toEqual({ error: null, value: 0, answered: true });
    expect(FakeHistory.instances[0]?.entries).toEqual([]);
  });

  it('fails to answer the last activation before fhem was heard about the reading', () => {
    const w = world();
    const sensor = serviceOf(w.accessory(contact('', 'door')).getServices(), 'ContactSensor');

    expect(read(characteristicOf(sensor, 'LastActivation'))).toMatchObject({ error: 'error', answered: true });
    expect(w.log.errors()).toContain('error door: Custom LastActivation characteristic: last update unknown ');
  });

  it('resets the counter', () => {
    const w = world();
    w.accessory(contact()).getServices();
    const history = FakeHistory.instances[0];
    if (!history) {
      throw new Error('no history service');
    }
    const reset = characteristicOf(history, 'Reset');

    expect(read(reset)).toEqual({ error: null, value: 0, answered: true });
    expect(write(reset, 42).answered).toBe(true);

    expect(read(reset)).toEqual({ error: null, value: 42, answered: true });
    expect(w.cached['door-EVE-TimesOpened']).toBe(0);
  });

  it('waits for the history to be loaded', () => {
    FakeHistory.loaded = false;
    const w = world();
    w.accessory(contact()).getServices();
    expect(w.cached['door-EVE-TimesOpened']).toBeUndefined();

    vi.advanceTimersByTime(50);
    expect(w.cached['door-EVE-TimesOpened']).toBeUndefined();

    FakeHistory.loaded = true;
    vi.advanceTimersByTime(10);
    expect(w.cached['door-EVE-TimesOpened']).toBe(3);
  });

  it('says so when nothing was persisted', () => {
    FakeHistory.persisted = undefined;
    const w = world();
    w.accessory(contact()).getServices();

    expect(w.log.debugLines).toContain('door: FakeGatoHistory extra persisted data is empty');
  });

  it('leaves out the door state, which the detection may have added', () => {
    const w = world();
    const accessory = w.accessory(contact('CurrentDoorState=state,values=closed:CLOSED;/.*/:OPEN'));
    const sensor = serviceOf(accessory.getServices(), 'ContactSensor');

    expect(sensor.characteristics.map((characteristic) => characteristic.displayName)).not.toContain('Current Door State');
    expect(w.log.errors()).toEqual(['error door: skipping CurrentDoorState characteristic as ContactSensor is also given and history is enabled']);
  });

  it('creates only one history service', () => {
    const w = world();
    w.accessory(contact('history=size=10')).getServices();

    expect(FakeHistory.instances).toHaveLength(1);
    expect(w.log.errors()).toEqual(['error door: FakeGatoHistory already created forContactSensor']);
  });

  it('is saved once when homebridge shuts down', () => {
    const w = world();
    w.accessory(contact()).getServices();

    w.shutdown();
    w.shutdown();

    expect(FakeHistory.instances[0]?.saved).toBe(1);
  });
});

describe('the kind of history', () => {
  it.each([
    ['thermostat', 'thermo'],
    ['thermometer', 'weather'],
    ['AirQualitySensor', 'room'],
    ['MotionSensor', 'motion'],
  ])('is chosen by the service: %s gets %s', (genericDeviceType, type) => {
    world()
      .accessory(
        device({
          Internals: { NAME: 'd' },
          Readings: { state: '1' },
          Attributes: { genericDeviceType, homebridgeMapping: 'history=size=10' },
        }),
      )
      .getServices();

    expect(FakeHistory.instances[0]?.type).toBe(type);
    expect(FakeHistory.instances[0]?.options).toEqual({ size: '10', storage: 'fs' });
  });

  it('can be given, and has a size of 1024 entries unless told otherwise', () => {
    world()
      .accessory(
        device({
          Internals: { NAME: 'd' },
          Readings: { state: 'on' },
          PossibleSets: 'on off',
          Attributes: { homebridgeMapping: 'history=type=energy' },
        }),
      )
      .getServices();

    expect(FakeHistory.instances[0]?.type).toBe('energy');
    expect(FakeHistory.instances[0]?.options).toEqual({ size: 1024, storage: 'fs' });
  });

  it('is unknown for other services', () => {
    const w = world();
    w.accessory(
      device({
        Internals: { NAME: 'd' },
        Readings: { state: 'on' },
        PossibleSets: 'on off',
        Attributes: { homebridgeMapping: 'history=size=10' },
      }),
    ).getServices();

    expect(FakeHistory.instances).toHaveLength(0);
    expect(w.log.errors()).toEqual(['error d: history: no type known for Switch']);
  });
});

describe('history entries', () => {
  it('records temperature, set point and valve position of a thermostat together', async () => {
    const w = world();
    w.accessory(
      device({
        Internals: { NAME: 'valve', TYPE: 'CUL_HM', DEF: '123456' },
        Readings: { 'desired-temp': '20.0', 'measured-temp': '19.0', actuator: '15' },
        Attributes: { subType: 'thermostat', homebridgeMapping: 'history=size=10' },
        PossibleSets: 'desired-temp:slider,4.5,0.5,30.5',
      }),
    ).getServices();
    const history = FakeHistory.instances[0];

    w.update('valve-measured-temp', '19.5');
    w.update('valve-desired-temp', '21.0');
    w.update('valve-actuator', '40');
    await vi.advanceTimersByTimeAsync(0);

    expect(history?.entries).toEqual([
      { time: 1786882200, setTemp: 20, currentTemp: 19.5, valvePosition: 15 },
      { time: 1786882200, setTemp: 21, currentTemp: 19.5, valvePosition: 15 },
      { time: 1786882200, setTemp: 21, currentTemp: 19.5, valvePosition: 40 },
    ]);
    expect(customUUIDs.Actuation).toBe('E863F12E-079E-48FF-8F27-9C2605A29F52');
  });

  it('records the readings of sensors', async () => {
    const w = world();
    w.accessory(
      device({
        Internals: { NAME: 'wetter', TYPE: 'netatmo' },
        Readings: { temperature: '20', humidity: '50', co2: '700', pressure: '1000', power: '5', state: 'ok' },
        Attributes: { homebridgeMapping: 'history=size=10 MotionDetected=bewegung' },
      }),
    ).getServices();
    const history = FakeHistory.instances[0];

    w.update('wetter-temperature', '21.5');
    w.update('wetter-humidity', '55');
    w.update('wetter-co2', '900');
    w.update('wetter-pressure', '1013');
    w.update('wetter-power', '7');
    w.update('wetter-bewegung', '1');
    w.update('wetter-bewegung', '0');
    await vi.advanceTimersByTimeAsync(0);

    expect(history?.type).toBe('room');
    expect(history?.entries).toEqual([
      { time: 1786882200, temp: 21.5 },
      { time: 1786882200, humidity: 55 },
      // the co2 concentration, not the air quality level it stands for
      { time: 1786882200, ppm: 900 },
      { time: 1786882200, pressure: 1013 },
      { time: 1786882200, power: 7 },
      { time: 1786882200, status: 1 },
      { time: 1786882200, status: 0 },
    ]);
  });

  it('records no air quality when its reading is no concentration', async () => {
    const w = world();
    w.accessory(
      device({
        Internals: { NAME: 'luft' },
        Readings: { state: 'gut' },
        Attributes: { genericDeviceType: 'AirQualitySensor', homebridgeMapping: 'AirQuality=state,values=gut:GOOD;/.*/:POOR history=size=10' },
      }),
    ).getServices();

    w.update('luft-state', 'schlecht');
    await vi.advanceTimersByTimeAsync(0);

    expect(FakeHistory.instances[0]?.entries).toEqual([]);
  });

  it('records nothing for other characteristics', async () => {
    const w = world();
    w.accessory(
      device({
        Internals: { NAME: 'wetter', TYPE: 'netatmo' },
        Readings: { temperature: '20', battery: '80', state: 'ok' },
        Attributes: { homebridgeMapping: 'history=size=10' },
      }),
    ).getServices();

    w.update('wetter-battery', '70');
    await vi.advanceTimersByTimeAsync(0);

    expect(FakeHistory.instances[0]?.entries).toEqual([]);
  });
});
