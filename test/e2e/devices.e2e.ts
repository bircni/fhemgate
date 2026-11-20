// every kind of device the detection knows that a dummy device can be: the genericDeviceType
// values, dimmers, coloured lights and sensors. for each: what is published, the first values,
// what a write sends to fhem and how an event arrives in HomeKit.
//
// the devices are dummy devices, so the same test runs against the stand-in and against a real
// fhem (set E2E_FHEM_URL). device types that need their hardware are in hardware.e2e.ts.
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { DummyDevice } from './fhem.ts';
import { uuids, type TypeName } from './homebridge.ts';
import { eventually, servicesByName, startWorld, type World } from './world.ts';

const securityStates = 'home:DISARMED;night:NIGHT_ARM;away:AWAY_ARM;stay:STAY_ARM';
const fs20Steps = 'dim06% dim12% dim18% dim25% dim31% dim37% dim43% dim50% dim56% dim62% dim68% dim75% dim81% dim87% dim93% dim100%';

const devices: DummyDevice[] = [
  // ---- the genericDeviceType values. switch, outlet, blind, lock and ignore are in scenarios.e2e.ts.
  {
    name: 'e2e_security',
    setList: 'home night away stay',
    readings: { state: 'home' },
    attributes: {
      genericDeviceType: 'security',
      homebridgeMapping:
        `SecuritySystemCurrentState=state,values=${securityStates} ` +
        'SecuritySystemTargetState=state,values=home:DISARM;night:NIGHT_ARM;away:AWAY_ARM;stay:STAY_ARM,cmds=DISARM:home;NIGHT_ARM:night;AWAY_ARM:away;STAY_ARM:stay',
    },
  },
  { name: 'e2e_switch', setList: 'on off', readings: { state: 'off' }, attributes: { genericDeviceType: 'switch' } },
  { name: 'e2e_light', setList: 'on off', readings: { state: 'on' }, attributes: { genericDeviceType: 'light' } },
  { name: 'e2e_thermometer', readings: { state: 'ok', 'measured-temp': '18.2' }, attributes: { genericDeviceType: 'thermometer' } },
  {
    name: 'e2e_heating',
    setList: 'desired-temp:16,17,18,19,20,21,22 mode',
    readingList: 'desired-temp mode',
    readings: { state: 'ok', 'desired-temp': '20', temperature: '19', actuator: '35', mode: 'auto' },
    attributes: { genericDeviceType: 'thermostat' },
  },
  {
    name: 'e2e_window_contact',
    readings: { state: 'closed', contact: 'closed (to VCCU)' },
    attributes: { genericDeviceType: 'contact', subType: 'threeStateSensor' },
  },
  { name: 'e2e_garage', setList: 'up down', readings: { state: 'down' }, attributes: { genericDeviceType: 'garage' } },
  {
    name: 'e2e_skylight',
    setList: 'pct:slider,0,1,100',
    readingList: 'pct',
    readings: { state: 'ok', pct: '10' },
    attributes: { genericDeviceType: 'window' },
  },
  // the name of a HomeKit service instead of one of the values above
  { name: 'e2e_fan', setList: 'on off', readings: { state: 'on' }, attributes: { genericDeviceType: 'Fan' } },
  {
    name: 'e2e_door',
    readings: { state: 'ok', doorState: 'closed', firmware: '1.2.3' },
    attributes: { genericDeviceType: 'GarageDoorOpener' },
  },

  // ---- recognised by an attribute other modules set
  { name: 'e2e_window_drive', setList: 'lock stop', readings: { state: 'locked' }, attributes: { model: 'HM-SEC-WIN' } },

  // ---- dimmers, recognised by the command they dim with. `set pct` is in scenarios.e2e.ts.
  { name: 'e2e_zwave', setList: 'on off dim:slider,0,1,99', readings: { state: 'dim 30' } },
  { name: 'e2e_fs20', setList: `on off ${fs20Steps}`, readings: { state: 'dim50%' } },
  {
    name: 'e2e_bri',
    setList: 'on off bri:slider,0,1,254 pct:slider,0,1,100',
    readingList: 'bri pct onoff',
    readings: { state: 'on', bri: '127', pct: '50', onoff: '1' },
  },

  // ---- coloured lights
  {
    name: 'e2e_color',
    setList: 'on off hue:slider,0,1,65535 sat:slider,0,1,254',
    readingList: 'hue sat',
    readings: { state: 'on', hue: '32768', sat: '127' },
  },
  { name: 'e2e_rgb', setList: 'on off rgb:colorpicker,RGB', readingList: 'rgb', readings: { state: 'on', rgb: 'FF0000' } },

  // ---- blinds
  {
    name: 'e2e_shutter',
    setList: 'position:slider,0,1,100',
    readingList: 'position',
    readings: { state: 'ok', position: '20', motor: 'stop' },
    attributes: { genericDeviceType: 'blind' },
  },

  // ---- sensors, recognised by their readings
  { name: 'e2e_lux', readings: { state: 'ok', luminance: '320' } },
  { name: 'e2e_air', readings: { state: 'ok', co2: '900' } },
  { name: 'e2e_weather', readings: { state: 'ok', temperature: '12.5', humidity: '80', pressure: '1013', battery: '80' } },
  { name: 'e2e_remote', setList: 'on off', readings: { state: 'off', battery: 'ok' } },
  { name: 'e2e_humidity', readings: { state: 'ok', humidity: '45' } },
  {
    name: 'e2e_plug',
    setList: 'on off',
    readings: { state: 'on', power: '45.5', voltage: '230.1', current: '0.2', energy: '1500 Wh' },
    attributes: { genericDeviceType: 'outlet' },
  },
  {
    name: 'e2e_presence',
    readings: { state: 'present' },
    attributes: {
      genericDeviceType: 'OccupancySensor',
      homebridgeMapping: 'OccupancyDetected=state,values=present:OCCUPANCY_DETECTED;absent:OCCUPANCY_NOT_DETECTED',
    },
  },

  // ---- media
  { name: 'e2e_avr', setList: 'on off volume:slider,0,1,100', readingList: 'volume', readings: { state: 'on', volume: '25' } },
];

let world: World;

beforeAll(async () => {
  world = await startWorld(devices, { room: 'e2e_devices' });
});

afterAll(async () => {
  await world.close();
});

const types = (names: TypeName[]) => names.map((name) => uuids[name]);

/** the lines of the log of homebridge that match */
const logged = (pattern: RegExp) =>
  world.homebridge
    .output()
    .split('\n')
    .filter((line) => pattern.test(line));

describe('what homebridge publishes', () => {
  it('is one accessory per device, with the service of its kind', () => {
    const expected: Record<string, TypeName> = {
      e2e_security: 'SecuritySystem',
      e2e_switch: 'Switch',
      e2e_light: 'Lightbulb',
      e2e_thermometer: 'TemperatureSensor',
      e2e_heating: 'Thermostat',
      e2e_window_contact: 'ContactSensor',
      e2e_garage: 'GarageDoorOpener',
      e2e_skylight: 'Window',
      e2e_fan: 'Fan',
      e2e_door: 'GarageDoorOpener',
      e2e_window_drive: 'Window',
      e2e_zwave: 'Lightbulb',
      e2e_fs20: 'Lightbulb',
      e2e_bri: 'Lightbulb',
      e2e_color: 'Lightbulb',
      e2e_rgb: 'Lightbulb',
      e2e_shutter: 'WindowCovering',
      e2e_lux: 'LightSensor',
      e2e_air: 'AirQualitySensor',
      e2e_weather: 'TemperatureSensor',
      e2e_remote: 'Switch',
      e2e_humidity: 'HumiditySensor',
      e2e_plug: 'Outlet',
      e2e_presence: 'OccupancySensor',
      e2e_avr: 'Switch',
    };

    expect(servicesByName(world.accessories)).toEqual(Object.fromEntries(Object.entries(expected).map(([device, service]) => [device, [uuids[service]]])));
  });

  // the characteristics a service has by itself are there as well, with the value HomeKit gives them
  it.each<[string, TypeName, TypeName[]]>([
    ['e2e_security', 'SecuritySystem', ['SecuritySystemCurrentState', 'SecuritySystemTargetState']],
    ['e2e_switch', 'Switch', ['On']],
    ['e2e_light', 'Lightbulb', ['On']],
    ['e2e_thermometer', 'TemperatureSensor', ['CurrentTemperature']],
    [
      'e2e_heating',
      'Thermostat',
      ['TemperatureDisplayUnits', 'CurrentHeatingCoolingState', 'TargetHeatingCoolingState', 'CurrentTemperature', 'TargetTemperature', 'Actuation'],
    ],
    ['e2e_window_contact', 'ContactSensor', ['ContactSensorState', 'CurrentDoorState']],
    ['e2e_garage', 'GarageDoorOpener', ['ObstructionDetected', 'CurrentDoorState', 'TargetDoorState']],
    // it is set with pct like a dimmer, and has a position and no brightness
    ['e2e_skylight', 'Window', ['PositionState', 'CurrentPosition', 'TargetPosition']],
    ['e2e_fan', 'Fan', ['On']],
    ['e2e_door', 'GarageDoorOpener', ['TargetDoorState', 'ObstructionDetected', 'CurrentDoorState']],
    ['e2e_window_drive', 'Window', ['PositionState', 'CurrentPosition', 'TargetPosition']],
    ['e2e_zwave', 'Lightbulb', ['On', 'Brightness']],
    ['e2e_fs20', 'Lightbulb', ['On', 'Brightness']],
    ['e2e_bri', 'Lightbulb', ['On', 'Brightness']],
    ['e2e_color', 'Lightbulb', ['On', 'Hue', 'Saturation']],
    ['e2e_rgb', 'Lightbulb', ['On', 'Hue', 'Saturation', 'Brightness']],
    ['e2e_shutter', 'WindowCovering', ['CurrentPosition', 'PositionState', 'TargetPosition']],
    ['e2e_lux', 'LightSensor', ['CurrentAmbientLightLevel']],
    ['e2e_air', 'AirQualitySensor', ['AirQuality', 'CarbonDioxideLevel']],
    ['e2e_weather', 'TemperatureSensor', ['CurrentTemperature', 'BatteryLevel', 'StatusLowBattery', 'CurrentRelativeHumidity', 'AirPressure']],
    ['e2e_remote', 'Switch', ['On', 'StatusLowBattery']],
    ['e2e_humidity', 'HumiditySensor', ['CurrentRelativeHumidity']],
    ['e2e_plug', 'Outlet', ['On', 'Voltage', 'Current', 'Power', 'Energy']],
    ['e2e_presence', 'OccupancySensor', ['OccupancyDetected']],
    ['e2e_avr', 'Switch', ['On', 'Volume']],
  ])('gives %s a %s with these characteristics: %s', (device, service, characteristics) => {
    expect(world.characteristicsOf(device, uuids[service])).toEqual(types(characteristics));
  });

  it.each<[string, TypeName, TypeName, number]>([
    ['e2e_security', 'SecuritySystem', 'SecuritySystemCurrentState', 3],
    ['e2e_security', 'SecuritySystem', 'SecuritySystemTargetState', 3],
    ['e2e_switch', 'Switch', 'On', 0],
    ['e2e_light', 'Lightbulb', 'On', 1],
    ['e2e_thermometer', 'TemperatureSensor', 'CurrentTemperature', 18.2],
    ['e2e_heating', 'Thermostat', 'TargetTemperature', 20],
    ['e2e_heating', 'Thermostat', 'CurrentTemperature', 19],
    ['e2e_heating', 'Thermostat', 'Actuation', 35],
    ['e2e_heating', 'Thermostat', 'TargetHeatingCoolingState', 3],
    // heating, as the valve is open
    ['e2e_heating', 'Thermostat', 'CurrentHeatingCoolingState', 1],
    ['e2e_window_contact', 'ContactSensor', 'ContactSensorState', 0],
    ['e2e_window_contact', 'ContactSensor', 'CurrentDoorState', 1],
    ['e2e_garage', 'GarageDoorOpener', 'CurrentDoorState', 1],
    ['e2e_garage', 'GarageDoorOpener', 'TargetDoorState', 1],
    ['e2e_skylight', 'Window', 'CurrentPosition', 10],
    ['e2e_skylight', 'Window', 'TargetPosition', 10],
    ['e2e_fan', 'Fan', 'On', 1],
    ['e2e_door', 'GarageDoorOpener', 'CurrentDoorState', 1],
    ['e2e_window_drive', 'Window', 'CurrentPosition', 0],
    ['e2e_zwave', 'Lightbulb', 'On', 1],
    ['e2e_zwave', 'Lightbulb', 'Brightness', 30],
    ['e2e_fs20', 'Lightbulb', 'On', 1],
    ['e2e_fs20', 'Lightbulb', 'Brightness', 50],
    ['e2e_bri', 'Lightbulb', 'On', 1],
    // bri 127 of 254
    ['e2e_bri', 'Lightbulb', 'Brightness', 50],
    // hue 32768 of 65535, sat 127 of 254
    ['e2e_color', 'Lightbulb', 'Hue', 180],
    ['e2e_color', 'Lightbulb', 'Saturation', 50],
    // rgb FF0000
    ['e2e_rgb', 'Lightbulb', 'Hue', 0],
    ['e2e_rgb', 'Lightbulb', 'Saturation', 100],
    ['e2e_rgb', 'Lightbulb', 'Brightness', 100],
    ['e2e_shutter', 'WindowCovering', 'CurrentPosition', 20],
    ['e2e_shutter', 'WindowCovering', 'TargetPosition', 20],
    ['e2e_shutter', 'WindowCovering', 'PositionState', 2],
    ['e2e_lux', 'LightSensor', 'CurrentAmbientLightLevel', 320],
    // 900 ppm is FAIR
    ['e2e_air', 'AirQualitySensor', 'AirQuality', 3],
    ['e2e_air', 'AirQualitySensor', 'CarbonDioxideLevel', 900],
    ['e2e_weather', 'TemperatureSensor', 'CurrentTemperature', 12.5],
    ['e2e_weather', 'TemperatureSensor', 'CurrentRelativeHumidity', 80],
    ['e2e_weather', 'TemperatureSensor', 'AirPressure', 1013],
    ['e2e_weather', 'TemperatureSensor', 'BatteryLevel', 80],
    ['e2e_weather', 'TemperatureSensor', 'StatusLowBattery', 0],
    ['e2e_remote', 'Switch', 'StatusLowBattery', 0],
    ['e2e_humidity', 'HumiditySensor', 'CurrentRelativeHumidity', 45],
    ['e2e_plug', 'Outlet', 'Power', 45.5],
    ['e2e_plug', 'Outlet', 'Voltage', 230.1],
    ['e2e_plug', 'Outlet', 'Current', 0.2],
    // 1500 Wh, shown as kWh
    ['e2e_plug', 'Outlet', 'Energy', 1.5],
    ['e2e_presence', 'OccupancySensor', 'OccupancyDetected', 1],
    ['e2e_avr', 'Switch', 'Volume', 25],
  ])('shows the reading of %s in %s/%s as %d', (device, service, type, value) => {
    expect(Number(world.named(device, service, type).value)).toBe(value);
  });

  it('shows the firmware reading as the firmware revision of the accessory', () => {
    expect(world.named('e2e_door', 'AccessoryInformation', 'FirmwareRevision').value).toBe('1.2.3');
  });

  it('takes the range of the target temperature from the values the set command lists', () => {
    expect(world.named('e2e_heating', 'Thermostat', 'TargetTemperature')).toMatchObject({ minValue: 16, maxValue: 22, minStep: 1 });
  });

  it('describes the characteristics Eve knows by format, unit and what may be done with them', () => {
    expect(world.named('e2e_avr', 'Switch', 'Volume')).toMatchObject({
      description: 'Volume',
      format: 'uint8',
      unit: 'percentage',
      minValue: 0,
      maxValue: 100,
      minStep: 1,
      perms: ['pr', 'pw', 'ev'],
    });
    expect(world.named('e2e_heating', 'Thermostat', 'Actuation')).toMatchObject({ format: 'uint8', unit: 'percentage', perms: ['pr', 'ev'] });
    expect(world.named('e2e_weather', 'TemperatureSensor', 'AirPressure')).toMatchObject({ description: 'AirPressure', format: 'uint16', perms: ['pr', 'ev'] });
    for (const name of ['Power', 'Voltage', 'Current', 'Energy'] as const) {
      expect(world.named('e2e_plug', 'Outlet', name)).toMatchObject({ description: name, format: 'float', perms: ['pr', 'ev'] });
    }
  });
});

describe('a value HomeKit writes', () => {
  it.each<[string, TypeName, TypeName, number | boolean, string, string, string]>([
    ['e2e_security', 'SecuritySystem', 'SecuritySystemTargetState', 1, 'away', 'state', 'away'],
    ['e2e_switch', 'Switch', 'On', true, 'on', 'state', 'on'],
    ['e2e_light', 'Lightbulb', 'On', false, 'off', 'state', 'off'],
    ['e2e_heating', 'Thermostat', 'TargetTemperature', 21, 'desired-temp 21', 'desired-temp', '21'],
    ['e2e_heating', 'Thermostat', 'TargetHeatingCoolingState', 1, 'mode manual', 'mode', 'manual'],
    ['e2e_heating', 'Thermostat', 'TargetHeatingCoolingState', 0, 'mode holiday_short', 'mode', 'holiday_short'],
    ['e2e_garage', 'GarageDoorOpener', 'TargetDoorState', 0, 'up', 'state', 'up'],
    ['e2e_skylight', 'Window', 'TargetPosition', 60, 'pct 60', 'pct', '60'],
    ['e2e_fan', 'Fan', 'On', false, 'off', 'state', 'off'],
    // the window drive is set without a command word, which leaves blanks
    ['e2e_window_drive', 'Window', 'TargetPosition', 40, '  40', 'state', '40'],
    ['e2e_window_drive', 'Window', 'TargetPosition', 0, '  lock', 'state', 'lock'],
    ['e2e_zwave', 'Lightbulb', 'On', false, 'off', 'state', 'off'],
    ['e2e_zwave', 'Lightbulb', 'Brightness', 60, 'dim 60', 'state', 'dim 60'],
    // sent as the nearest of the sixteen steps, without a command word
    ['e2e_fs20', 'Lightbulb', 'Brightness', 50, '  dim50%', 'state', 'dim50%'],
    ['e2e_fs20', 'Lightbulb', 'Brightness', 10, '  dim12%', 'state', 'dim12%'],
    ['e2e_fs20', 'Lightbulb', 'On', false, 'off', 'state', 'off'],
    // brightness is read from bri and set with pct
    ['e2e_bri', 'Lightbulb', 'Brightness', 80, 'pct 80', 'pct', '80'],
    // scaled to the range of the device
    ['e2e_color', 'Lightbulb', 'Hue', 90, 'hue 16429', 'hue', '16429'],
    ['e2e_color', 'Lightbulb', 'Saturation', 100, 'sat 254', 'sat', '254'],
    // each of the three changes the one rgb value
    ['e2e_rgb', 'Lightbulb', 'Hue', 120, 'rgb 00ff00', 'rgb', '00ff00'],
    ['e2e_rgb', 'Lightbulb', 'Saturation', 50, 'rgb 80ff80', 'rgb', '80ff80'],
    ['e2e_rgb', 'Lightbulb', 'Brightness', 50, 'rgb 408040', 'rgb', '408040'],
    ['e2e_shutter', 'WindowCovering', 'TargetPosition', 70, 'position 70', 'position', '70'],
    ['e2e_plug', 'Outlet', 'On', false, 'off', 'state', 'off'],
    ['e2e_avr', 'Switch', 'Volume', 30, 'volume 30', 'volume', '30'],
  ])('to %s %s/%s as %s reaches fhem as: set %s', async (device, service, type, value, command, reading, expected) => {
    await world.homebridge.write(world.named(device, service, type), value);

    await world.fhem.wasSet(device, command, reading, expected);
  });

  it('is not sent when it leaves the light at the colour it has', async () => {
    const sent = () => logged(/executing: .*set%20e2e_rgb/).length;
    const before = sent();

    // the saturation it was set to above
    await world.homebridge.write(world.named('e2e_rgb', 'Lightbulb', 'Saturation'), 50);

    await eventually('the plugin to log that nothing changes', () => (logged(/converted value is unchanged/).length ? true : undefined), world.homebridge);
    expect(sent()).toBe(before);
  });
});

describe('a reading that changes in fhem', () => {
  it.each<[string, string, string, TypeName, TypeName, number]>([
    ['e2e_security', 'state', 'night', 'SecuritySystem', 'SecuritySystemCurrentState', 2],
    ['e2e_security', 'state', 'stay', 'SecuritySystem', 'SecuritySystemTargetState', 0],
    ['e2e_switch', 'state', 'off', 'Switch', 'On', 0],
    ['e2e_light', 'state', 'on', 'Lightbulb', 'On', 1],
    ['e2e_thermometer', 'measured-temp', '19.4', 'TemperatureSensor', 'CurrentTemperature', 19.4],
    ['e2e_heating', 'temperature', '21.5', 'Thermostat', 'CurrentTemperature', 21.5],
    ['e2e_heating', 'desired-temp', '18', 'Thermostat', 'TargetTemperature', 18],
    ['e2e_heating', 'actuator', '80', 'Thermostat', 'Actuation', 80],
    // the valve is closed, so it does not heat
    ['e2e_heating', 'actuator', '0', 'Thermostat', 'CurrentHeatingCoolingState', 0],
    ['e2e_heating', 'actuator', '15', 'Thermostat', 'CurrentHeatingCoolingState', 1],
    ['e2e_heating', 'mode', 'auto', 'Thermostat', 'TargetHeatingCoolingState', 3],
    ['e2e_window_contact', 'contact', 'open (to VCCU)', 'ContactSensor', 'ContactSensorState', 1],
    ['e2e_window_contact', 'contact', 'closed (to VCCU)', 'ContactSensor', 'CurrentDoorState', 1],
    ['e2e_garage', 'state', 'down', 'GarageDoorOpener', 'CurrentDoorState', 1],
    ['e2e_garage', 'state', 'up', 'GarageDoorOpener', 'TargetDoorState', 0],
    ['e2e_skylight', 'pct', '90', 'Window', 'CurrentPosition', 90],
    ['e2e_fan', 'state', 'on', 'Fan', 'On', 1],
    ['e2e_door', 'doorState', 'opening', 'GarageDoorOpener', 'CurrentDoorState', 2],
    ['e2e_door', 'doorState', 'open', 'GarageDoorOpener', 'CurrentDoorState', 0],
    // the window drive reports its opening in percent, or that it is locked
    ['e2e_window_drive', 'state', '75 %', 'Window', 'CurrentPosition', 75],
    ['e2e_window_drive', 'state', 'locked', 'Window', 'CurrentPosition', 0],
    ['e2e_zwave', 'state', 'dim 45', 'Lightbulb', 'Brightness', 45],
    ['e2e_zwave', 'state', 'dim 0', 'Lightbulb', 'On', 0],
    ['e2e_fs20', 'state', 'dim25%', 'Lightbulb', 'Brightness', 25],
    ['e2e_fs20', 'state', 'off', 'Lightbulb', 'On', 0],
    ['e2e_bri', 'bri', '254', 'Lightbulb', 'Brightness', 100],
    ['e2e_bri', 'onoff', '0', 'Lightbulb', 'On', 0],
    ['e2e_color', 'hue', '0', 'Lightbulb', 'Hue', 0],
    ['e2e_color', 'sat', '127', 'Lightbulb', 'Saturation', 50],
    // two thirds of the 359 the hue is scaled to
    ['e2e_rgb', 'rgb', '0000FF', 'Lightbulb', 'Hue', 239],
    ['e2e_rgb', 'rgb', '0000CC', 'Lightbulb', 'Brightness', 80],
    ['e2e_shutter', 'position', '55', 'WindowCovering', 'CurrentPosition', 55],
    ['e2e_shutter', 'motor', 'up', 'WindowCovering', 'PositionState', 1],
    ['e2e_shutter', 'motor', 'down', 'WindowCovering', 'PositionState', 0],
    ['e2e_lux', 'luminance', '12', 'LightSensor', 'CurrentAmbientLightLevel', 12],
    // 1600 ppm is POOR
    ['e2e_air', 'co2', '1600', 'AirQualitySensor', 'AirQuality', 5],
    ['e2e_air', 'co2', '500', 'AirQualitySensor', 'CarbonDioxideLevel', 500],
    ['e2e_weather', 'temperature', '-4', 'TemperatureSensor', 'CurrentTemperature', -4],
    ['e2e_weather', 'humidity', '93', 'TemperatureSensor', 'CurrentRelativeHumidity', 93],
    ['e2e_weather', 'pressure', '990', 'TemperatureSensor', 'AirPressure', 990],
    ['e2e_weather', 'battery', '15', 'TemperatureSensor', 'StatusLowBattery', 1],
    ['e2e_weather', 'battery', '60', 'TemperatureSensor', 'BatteryLevel', 60],
    ['e2e_remote', 'battery', 'low', 'Switch', 'StatusLowBattery', 1],
    ['e2e_humidity', 'humidity', '50', 'HumiditySensor', 'CurrentRelativeHumidity', 50],
    ['e2e_plug', 'power', '100', 'Outlet', 'Power', 100],
    ['e2e_plug', 'voltage', '228.5', 'Outlet', 'Voltage', 228.5],
    ['e2e_plug', 'current', '0.5', 'Outlet', 'Current', 0.5],
    ['e2e_plug', 'energy', '2500 Wh', 'Outlet', 'Energy', 2.5],
    ['e2e_presence', 'state', 'absent', 'OccupancySensor', 'OccupancyDetected', 0],
    ['e2e_avr', 'volume', '60', 'Switch', 'Volume', 60],
  ])('%s %s = %s is told to HomeKit as %s/%s = %d', async (device, reading, value, service, type, expected) => {
    const target = world.named(device, service, type);

    await world.notifies(target, expected, () => world.fhem.change(device, reading, value));
    await world.becomes(target, expected);
  });
});
