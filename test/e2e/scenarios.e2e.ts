// fhem -> plugin -> homebridge and back, for one device of every common kind.
//
// a real homebridge loads the built plugin. the devices are dummy devices, so the same test
// runs against the stand-in and against a real fhem (set E2E_FHEM_URL).
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { startFhemWith, type DummyDevice, type FhemUnderTest } from './fhem.ts';
import { hapType, startHomebridge, type HapAccessory, type HapCharacteristic, type Homebridge } from './homebridge.ts';

const devices: DummyDevice[] = [
  { name: 'e2e_lamp', setList: 'on off', readings: { state: 'on' }, attributes: { alias: 'Stehlampe', siriName: 'Stehlampe Wohnzimmer' } },
  { name: 'e2e_dimmer', setList: 'on off pct:slider,0,1,100', readingList: 'pct', readings: { state: 'on', pct: '40' } },
  {
    name: 'e2e_thermostat',
    setList: 'desired-temp:slider,5,0.5,30',
    readingList: 'desired-temp',
    readings: { state: 'ok', 'desired-temp': '21', temperature: '19.5', humidity: '48' },
  },
  { name: 'e2e_blind', setList: 'pct:slider,0,1,100', readingList: 'pct', readings: { state: '30', pct: '30' }, attributes: { genericDeviceType: 'blind' } },
  {
    name: 'e2e_contact',
    readings: { state: 'closed' },
    attributes: { genericDeviceType: 'ContactSensor', homebridgeMapping: 'ContactSensorState=state,values=closed:CONTACT_DETECTED;open:CONTACT_NOT_DETECTED' },
  },
  { name: 'e2e_climate', readings: { state: 'ok', temperature: '21.3', humidity: '55' } },
  { name: 'e2e_lock', setList: 'lock:locked,unlocked', readings: { state: 'locked' }, attributes: { genericDeviceType: 'lock' } },
  { name: 'e2e_outlet', setList: 'on off', readings: { state: 'off' }, attributes: { genericDeviceType: 'outlet' } },
  { name: 'e2e_ignored', setList: 'on off', readings: { state: 'on' }, attributes: { genericDeviceType: 'ignore' } },
];

let fhem: FhemUnderTest;
let homebridge: Homebridge;
let accessories: HapAccessory[];

async function eventually<T>(what: string, attempt: () => Promise<T | undefined>): Promise<T> {
  const deadline = Date.now() + 60_000;
  for (;;) {
    const result = await attempt().catch(() => undefined);
    if (result !== undefined) {
      return result;
    }
    if (Date.now() > deadline) {
      throw new Error(`timed out waiting for ${what}. homebridge said:\n${homebridge.output()}`);
    }
    await new Promise((resolve) => setTimeout(resolve, 200));
  }
}

// HomeKit is told the siriName of a device as the name of its accessory, or its alias, or the name it has in fhem
const nameOf = (device: string) => devices.find((dummy) => dummy.name === device)?.attributes?.siriName ?? device;

/** the characteristic of the accessory for the fhem device */
function characteristic(device: string, service: string, type: string): HapCharacteristic {
  const accessory = accessories.find((candidate) => candidate.name === nameOf(device));
  const found = accessory?.services.find((candidate) => candidate.type === service)?.characteristics.find((candidate) => candidate.type === type);
  if (!found) {
    throw new Error(`${device} has no characteristic ${type} on a service ${service}`);
  }
  return found;
}

const becomes = (target: HapCharacteristic, value: number) =>
  eventually(`the characteristic to become ${value}`, async () => (Number(await homebridge.read(target)) === value ? true : undefined));

beforeAll(async () => {
  fhem = await startFhemWith(devices);
  homebridge = await startHomebridge(fhem.platformConfig);

  accessories = await eventually('homebridge to publish the devices', async () => {
    const published = await homebridge.accessories();
    return published.length ? published : undefined;
  });
});

afterAll(async () => {
  await homebridge.stop();
  await fhem.close();
});

describe('what homebridge publishes', () => {
  it('is one accessory per device, with the service of its kind', () => {
    const services = Object.fromEntries(
      accessories.map((accessory) => [
        accessory.name,
        accessory.services.map((service) => service.type).filter((type) => type !== hapType.AccessoryInformation),
      ]),
    );

    expect(services).toEqual({
      'Stehlampe Wohnzimmer': [hapType.Switch],
      e2e_dimmer: [hapType.Lightbulb],
      e2e_thermostat: [hapType.Thermostat],
      e2e_blind: [hapType.WindowCovering],
      e2e_contact: [hapType.ContactSensor],
      e2e_climate: [hapType.TemperatureSensor],
      e2e_lock: [hapType.LockMechanism],
      e2e_outlet: [hapType.Outlet],
    });
  });

  it('leaves out the device that is to be ignored', () => {
    expect(accessories.map((accessory) => accessory.name)).not.toContain('e2e_ignored');
    expect(homebridge.output()).toContain('ignoring e2e_ignored');
  });

  it('names the service after the siriName', () => {
    expect(characteristic('e2e_lamp', hapType.Switch, hapType.Name).value).toBe('Stehlampe Wohnzimmer');
  });

  it.each([
    ['e2e_lamp', hapType.Switch, hapType.On, 1],
    ['e2e_outlet', hapType.Outlet, hapType.On, 0],
    ['e2e_dimmer', hapType.Lightbulb, hapType.On, 1],
    ['e2e_dimmer', hapType.Lightbulb, hapType.Brightness, 40],
    ['e2e_thermostat', hapType.Thermostat, hapType.TargetTemperature, 21],
    ['e2e_thermostat', hapType.Thermostat, hapType.CurrentTemperature, 19.5],
    ['e2e_thermostat', hapType.Thermostat, hapType.CurrentRelativeHumidity, 48],
    ['e2e_blind', hapType.WindowCovering, hapType.CurrentPosition, 30],
    ['e2e_blind', hapType.WindowCovering, hapType.TargetPosition, 30],
    ['e2e_contact', hapType.ContactSensor, hapType.ContactSensorState, 0],
    ['e2e_climate', hapType.TemperatureSensor, hapType.CurrentTemperature, 21.3],
    ['e2e_climate', hapType.TemperatureSensor, hapType.CurrentRelativeHumidity, 55],
    ['e2e_lock', hapType.LockMechanism, hapType.LockCurrentState, 1],
    ['e2e_lock', hapType.LockMechanism, hapType.LockTargetState, 1],
  ])('shows the reading of %s in characteristic %s/%s as %d', (device, service, type, value) => {
    expect(Number(characteristic(device, service, type).value)).toBe(value);
  });
});

describe('a value HomeKit writes', () => {
  it.each([
    ['e2e_lamp', hapType.Switch, hapType.On, false, 'off', 'state', 'off'],
    ['e2e_lamp', hapType.Switch, hapType.On, true, 'on', 'state', 'on'],
    ['e2e_outlet', hapType.Outlet, hapType.On, true, 'on', 'state', 'on'],
    ['e2e_dimmer', hapType.Lightbulb, hapType.On, false, 'off', 'state', 'off'],
    // these three wait a second for more changes before they are sent
    ['e2e_dimmer', hapType.Lightbulb, hapType.Brightness, 70, 'pct 70', 'pct', '70'],
    ['e2e_thermostat', hapType.Thermostat, hapType.TargetTemperature, 22.5, 'desired-temp 22.5', 'desired-temp', '22.5'],
    ['e2e_blind', hapType.WindowCovering, hapType.TargetPosition, 80, 'pct 80', 'pct', '80'],
    ['e2e_lock', hapType.LockMechanism, hapType.LockTargetState, 0, 'lock unlocked', 'state', 'lock unlocked'],
  ])('to %s %s/%s as %s reaches fhem as: set %s', async (device, service, type, value, command, reading, expected) => {
    await homebridge.write(characteristic(device, service, type), value);

    await fhem.wasSet(device, command, reading, expected);
  });
});

describe('a reading that changes in fhem', () => {
  it.each([
    ['e2e_lamp', 'state', 'off', hapType.Switch, hapType.On, 0],
    ['e2e_lamp', 'state', 'on', hapType.Switch, hapType.On, 1],
    ['e2e_dimmer', 'pct', '25', hapType.Lightbulb, hapType.Brightness, 25],
    ['e2e_dimmer', 'pct', '0', hapType.Lightbulb, hapType.On, 0],
    ['e2e_thermostat', 'temperature', '20.5', hapType.Thermostat, hapType.CurrentTemperature, 20.5],
    ['e2e_thermostat', 'desired-temp', '18', hapType.Thermostat, hapType.TargetTemperature, 18],
    ['e2e_thermostat', 'humidity', '60', hapType.Thermostat, hapType.CurrentRelativeHumidity, 60],
    ['e2e_blind', 'pct', '100', hapType.WindowCovering, hapType.CurrentPosition, 100],
    ['e2e_contact', 'state', 'open', hapType.ContactSensor, hapType.ContactSensorState, 1],
    ['e2e_contact', 'state', 'closed', hapType.ContactSensor, hapType.ContactSensorState, 0],
    ['e2e_climate', 'temperature', '-3.5', hapType.TemperatureSensor, hapType.CurrentTemperature, -3.5],
    ['e2e_climate', 'humidity', '71', hapType.TemperatureSensor, hapType.CurrentRelativeHumidity, 71],
    ['e2e_lock', 'state', 'unlocked', hapType.LockMechanism, hapType.LockCurrentState, 0],
  ])('%s %s = %s arrives in HomeKit as %s/%s = %d', async (device, reading, value, service, type, expected) => {
    await fhem.change(device, reading, value);

    await becomes(characteristic(device, service, type), expected);
  });
});

describe('the connection to fhem', () => {
  it('is opened again after fhem ended it, and events arrive as before', async (context) => {
    if (!fhem.fake) {
      // a real fhem is not restarted from here
      context.skip();
      return;
    }

    fhem.fake.endStreams();
    await eventually('the plugin to open the long poll again', () => Promise.resolve((fhem.fake?.streams.length ?? 0) >= 2 ? true : undefined));
    await eventually('the long poll to be open', () => Promise.resolve(fhem.fake?.openStreams() ? true : undefined));

    await fhem.change('e2e_outlet', 'state', 'off');
    await becomes(characteristic('e2e_outlet', hapType.Outlet, hapType.On), 0);
    await fhem.change('e2e_outlet', 'state', 'on');
    await becomes(characteristic('e2e_outlet', hapType.Outlet, hapType.On), 1);
  });
});
