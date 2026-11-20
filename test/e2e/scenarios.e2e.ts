// fhem -> plugin -> homebridge and back, for one device of every common kind.
//
// a real homebridge loads the built plugin. the devices are dummy devices, so the same test
// runs against the stand-in and against a real fhem (set E2E_FHEM_URL).
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { DummyDevice } from './fhem.ts';
import { hapType, type HapCharacteristic } from './homebridge.ts';
import { eventually, servicesByName, startWorld, type World } from './world.ts';

const devices: DummyDevice[] = [
  { name: 'e2e_lamp', setList: 'on off toggle', readings: { state: 'on' }, attributes: { alias: 'Stehlampe', siriName: 'Stehlampe Wohnzimmer' } },
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
  { name: 'e2e_aliased', setList: 'on off', readings: { state: 'off' }, attributes: { alias: 'Flurlicht' } },
  { name: 'e2e_ignored', setList: 'on off', readings: { state: 'on' }, attributes: { genericDeviceType: 'ignore' } },
  // the platform is configured with a filter for the room of the others
  { name: 'e2e_elsewhere', setList: 'on off', readings: { state: 'on' }, attributes: { room: 'e2e_not_for_homekit' } },
];

let world: World;

beforeAll(async () => {
  world = await startWorld(devices, { room: 'e2e_scenarios', publishes: 9 });
});

afterAll(async () => {
  await world.close();
});

describe('what homebridge publishes', () => {
  it('is one accessory per device, with the service of its kind', () => {
    expect(servicesByName(world.accessories)).toEqual({
      'Stehlampe Wohnzimmer': [hapType.Switch],
      e2e_dimmer: [hapType.Lightbulb],
      e2e_thermostat: [hapType.Thermostat],
      e2e_blind: [hapType.WindowCovering],
      e2e_contact: [hapType.ContactSensor],
      e2e_climate: [hapType.TemperatureSensor],
      e2e_lock: [hapType.LockMechanism],
      e2e_outlet: [hapType.Outlet],
      Flurlicht: [hapType.Switch],
    });
  });

  it('leaves out the device that is to be ignored', () => {
    expect(world.accessories.map((accessory) => accessory.name)).not.toContain('e2e_ignored');
    expect(world.homebridge.output()).toContain('ignoring e2e_ignored');
  });

  it('leaves out the device the filter of the platform does not select', () => {
    expect(world.accessories.map((accessory) => accessory.name)).not.toContain('e2e_elsewhere');
    expect(world.homebridge.output()).not.toContain('e2e_elsewhere');
  });

  it('names accessory and service after the siriName, or else after the alias', () => {
    expect(world.characteristic('e2e_lamp', hapType.Switch, hapType.Name).value).toBe('Stehlampe Wohnzimmer');
    expect(world.characteristic('e2e_aliased', hapType.Switch, hapType.Name).value).toBe('Flurlicht');
    expect(world.characteristic('e2e_aliased', hapType.AccessoryInformation, hapType.Name).value).toBe('Flurlicht');
  });

  it('tells what kind of fhem device an accessory is', () => {
    expect(world.characteristic('e2e_lamp', hapType.AccessoryInformation, hapType.Manufacturer).value).toBe('FHEM:dummy');
    expect(world.characteristic('e2e_lamp', hapType.AccessoryInformation, hapType.Model).value).toBe('FHEM:<unknown>');
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
    expect(Number(world.characteristic(device, service, type).value)).toBe(value);
  });
});

describe('a thermostat without a command for its mode', () => {
  it('offers heating as its only mode', () => {
    const mode = world.characteristic('e2e_thermostat', hapType.Thermostat, hapType.TargetHeatingCoolingState);

    expect(mode).toMatchObject({ value: 1, 'valid-values': [1] });
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
    await world.homebridge.write(world.characteristic(device, service, type), value);

    await world.fhem.wasSet(device, command, reading, expected);
  });
});

describe('opening the door of a lock', () => {
  it('is a push button: the command is sent, and half a second later HomeKit is told that the door is closed again', async () => {
    const door = world.characteristic('e2e_lock', hapType.LockMechanism, hapType.TargetDoorState);
    expect(door.value).toBe(1);

    await world.notifies(door, 1, async () => {
      await world.notifies(door, 0, () => world.homebridge.write(door, 0));
      await world.fhem.wasSet('e2e_lock', 'open', 'state', 'open');
    });
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
    ['e2e_lock', 'state', 'locked', hapType.LockMechanism, hapType.LockCurrentState, 1],
  ])('%s %s = %s is told to HomeKit as %s/%s = %d', async (device, reading, value, service, type, expected) => {
    const target = world.characteristic(device, service, type);

    await world.notifies(target, expected, () => world.fhem.change(device, reading, value));
    await world.becomes(target, expected);
  });
});

describe('a request to identify', () => {
  it('toggles a device that can be toggled, twice', async () => {
    await world.homebridge.write(world.characteristic('e2e_lamp', hapType.AccessoryInformation, hapType.Identify), true);

    // fhem runs the three commands one after the other, a dummy shows the last toggle as its state
    await world.fhem.wasSet('e2e_lamp', 'toggle; sleep 1; set e2e_lamp toggle', 'state', 'toggle');
  });

  it('does nothing for a device without a toggle command', async () => {
    await world.homebridge.write(world.characteristic('e2e_outlet', hapType.AccessoryInformation, hapType.Identify), true);

    await eventually(
      'the request to be logged',
      () => (world.homebridge.output().includes('[e2e-outlet] identify requested!') ? true : undefined),
      world.homebridge,
    );
    expect(world.homebridge.output()).not.toMatch(/set e2e_outlet toggle/);
  });
});

describe('a controller that is subscribed to a characteristic', () => {
  it('is sent an event when the reading changes in fhem, without asking', async () => {
    const on = world.characteristic('e2e_outlet', hapType.Outlet, hapType.On);
    const contact = world.characteristic('e2e_contact', hapType.ContactSensor, hapType.ContactSensorState);
    // read first: a read that finds another value than HomeKit last saw is announced as well
    const before = Number(await world.homebridge.read(on));
    const subscription = await world.homebridge.subscribe([on, contact]);
    const eventFor = (target: HapCharacteristic, value: unknown) =>
      eventually(
        `an event for ${target.aid}.${target.iid} with ${String(value)}`,
        () => (subscription.events.some((event) => event.aid === target.aid && event.iid === target.iid && event.value === value) ? true : undefined),
        world.homebridge,
      );

    try {
      await world.fhem.change('e2e_outlet', 'state', before ? 'off' : 'on');
      await eventFor(on, before ? 0 : 1);
      await world.fhem.change('e2e_outlet', 'state', before ? 'on' : 'off');
      await eventFor(on, before ? 1 : 0);

      await world.fhem.change('e2e_contact', 'state', 'open');
      await eventFor(contact, 1);
      await world.fhem.change('e2e_contact', 'state', 'closed');
      await eventFor(contact, 0);

      // only what changed is announced, and each change once
      expect(subscription.events).toHaveLength(4);
    } finally {
      subscription.close();
    }
  });
});

describe('the connection to fhem', () => {
  it('is opened again after fhem ended it, and events arrive as before', async (context) => {
    const fake = world.fhem.fake;
    if (!fake) {
      // a real fhem is not restarted from here
      context.skip();
      return;
    }

    const streams = fake.streams.length;
    fake.endStreams();
    await eventually('the plugin to open the long poll again', () => (fake.streams.length > streams && fake.openStreams() ? true : undefined));

    const on = world.characteristic('e2e_outlet', hapType.Outlet, hapType.On);
    await world.notifies(on, 0, () => world.fhem.change('e2e_outlet', 'state', 'off'));
    await world.notifies(on, 1, () => world.fhem.change('e2e_outlet', 'state', 'on'));
  });
});
