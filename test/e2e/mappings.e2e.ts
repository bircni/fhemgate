// what the homebridgeMapping attribute can say, one device per feature: fhem -> plugin ->
// homebridge and back.
//
// the devices are dummy devices, so the same test runs against the stand-in and against a real
// fhem (set E2E_FHEM_URL). the eventMap attribute is in hardware.e2e.ts, as a real fhem applies
// it before the plugin sees a value.
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { DummyDevice } from './fhem.ts';
import { hapType, type TypeName } from './homebridge.ts';
import { eventually, servicesByName, startWorld, type World } from './world.ts';

// the file the jsFunctions option of the platform names
const functions = `module.exports = {
  byteToPercent: (mapping, orig) => Math.round(Number(orig) / 2.55),
  percentToByte: (mapping, orig) => Math.round(orig * 2.55),
  fails: () => {
    throw new Error('boom');
  },
};`;

const devices: DummyDevice[] = [
  { name: 'e2e_m_other', readings: { state: 'ok', temperature: '18.5' } },

  // <cmd>:<device>:<reading> with the device left out, the reading of another device, the range
  // shown to HomeKit, values and cmds as plain pairs, valid and default
  {
    name: 'e2e_m_thermostat',
    setList: 'target:slider,18,0.5,25 mode:auto,manual,boost',
    readingList: 'target mode',
    readings: { state: 'ok', target: '20', mode: 'auto' },
    attributes: {
      genericDeviceType: 'thermostat',
      homebridgeMapping:
        'TargetTemperature=target::target,minValue=18,maxValue=25,minStep=0.5 ' +
        'CurrentTemperature=e2e_m_other:temperature ' +
        'TargetHeatingCoolingState=mode,values=auto:AUTO;manual:HEAT,cmds=AUTO:mode+auto;HEAT:mode+manual,valid=AUTO;HEAT,default=HEAT',
    },
  },

  // values and cmds with regular expressions, and `#` for the value as it is
  {
    name: 'e2e_m_light',
    setList: 'on off level',
    readingList: 'level',
    readings: { state: 'on', level: '55' },
    attributes: {
      genericDeviceType: 'light',
      homebridgeMapping: 'Brightness=level::level,values=/^\\d+$/:#;low:10;full:100,cmds=100:level+full;/^\\d$/:level+low',
    },
  },

  // clear for the whole device, the subtype parameter for several services of one type,
  // valueOn and valueOff as text and as regular expression, cmdOn, cmdOff and cmd
  {
    name: 'e2e_m_hub',
    setList: 'activity:TV,DVD,PowerOff off',
    readingList: 'activity',
    readings: { state: 'ok', activity: 'TV' },
    attributes: {
      genericDeviceType: 'switch',
      homebridgeMapping:
        'clear ' +
        'On=activity,subtype=TV,valueOn=TV,cmdOn=activity+TV,cmdOff=off ' +
        'On=activity,subtype=DVD,valueOn=/DVD/,cmdOn=activity+DVD,cmdOff=off ' +
        'On=activity,subtype=Off,valueOn=PowerOff,valueOff=PowerOff,cmd=off',
    },
  },

  // default and timeout make a push button
  {
    name: 'e2e_m_button',
    setList: 'press',
    readings: { state: 'idle' },
    attributes: { genericDeviceType: 'switch', homebridgeMapping: 'On=button,cmdOn=press,default=0,timeout=500' },
  },

  {
    name: 'e2e_m_delay',
    setList: 'on off bright',
    readingList: 'bright',
    readings: { state: 'on', bright: '5' },
    attributes: { genericDeviceType: 'light', homebridgeMapping: 'Brightness=bright::bright,delay=1500' },
  },

  // factor, max with maxValue, and invert within minValue and maxValue
  {
    name: 'e2e_m_scaled',
    setList: 'on off raw tint ct',
    readingList: 'raw tint ct',
    readings: { state: 'on', raw: '100', tint: '500', ct: '200' },
    attributes: {
      genericDeviceType: 'light',
      homebridgeMapping: 'Brightness=raw::raw,factor=0.5 Hue=tint::tint,max=1000,maxValue=359 ColorTemperature=ct::ct,invert=true,minValue=140,maxValue=500',
    },
  },

  // invert added to the mappings the detection made
  {
    name: 'e2e_m_blind',
    setList: 'pct:slider,0,1,100',
    readingList: 'pct',
    readings: { state: 'ok', pct: '30' },
    attributes: { genericDeviceType: 'blind', homebridgeMapping: 'CurrentPosition=invert=true TargetPosition=invert=true' },
  },

  {
    name: 'e2e_m_parts',
    readings: { state: 'ok', measurement: 'T: 21.5 H: 60' },
    attributes: { genericDeviceType: 'thermometer', homebridgeMapping: 'CurrentTemperature=measurement,part=1 CurrentRelativeHumidity=measurement,part=3' },
  },
  {
    name: 'e2e_m_motion',
    readings: { state: 'ok', movement: '150' },
    attributes: { genericDeviceType: 'MotionSensor', homebridgeMapping: 'MotionDetected=movement,threshold=100' },
  },

  { name: 'e2e_m_suffix', setList: 'on off', readings: { state: 'off' }, attributes: { homebridgeMapping: 'On=cmdSuffix=5' } },
  { name: 'e2e_m_readonly', setList: 'on off', readings: { state: 'off' }, attributes: { homebridgeMapping: 'On=readOnly=true' } },
  {
    name: 'e2e_m_nocache',
    readings: { state: 'ok', temp2: '15' },
    attributes: { genericDeviceType: 'thermometer', homebridgeMapping: 'CurrentTemperature=temp2,nocache=true' },
  },

  // <service>#<characteristic> and <service>(<subtype>)#<characteristic> for more services
  {
    name: 'e2e_m_multi',
    setList: 'on off',
    readings: { state: 'on', akku: '80', charging: 'yes', temperature1: '21.5', temperature2: '-3' },
    attributes: {
      genericDeviceType: 'switch',
      homebridgeMapping:
        'Battery#BatteryLevel=akku ' +
        'Battery#StatusLowBattery=akku,threshold=20,values=0:BATTERY_LEVEL_LOW;1:BATTERY_LEVEL_NORMAL ' +
        'Battery#ChargingState=charging,values=yes:CHARGING;no:NOT_CHARGING ' +
        'TemperatureSensor(innen)#CurrentTemperature=temperature1,minValue=-30 ' +
        'TemperatureSensor(aussen)#CurrentTemperature=temperature2,minValue=-30',
    },
  },

  // linkedTo
  {
    name: 'e2e_m_tv',
    setList: 'power input',
    readingList: 'power input',
    readings: { state: 'ok', power: 'on', input: 'hdmi2' },
    attributes: {
      genericDeviceType: 'Television',
      homebridgeMapping:
        'clear ' +
        'Television#Active=power,values=on:ACTIVE;off:INACTIVE,cmds=ACTIVE:power+on;INACTIVE:power+off ' +
        'ActiveIdentifier=input,values=hdmi1:1;hdmi2:2,cmds=1:input+hdmi1;2:input+hdmi2 ' +
        'InputSource(hdmi1)#Identifier=default=1 linkedTo=Television ' +
        'InputSource(hdmi2)#Identifier=default=2 linkedTo=Television',
    },
  },

  // characteristics HomeKit does not define, by uuid and by the name the plugin knows them under
  {
    name: 'e2e_m_custom',
    setList: 'on off vol',
    readingList: 'vol',
    readings: { state: 'on', watt: '17.5', vol: '30', volt: '229' },
    attributes: {
      homebridgeMapping:
        'E863F10D-079E-48FF-8F27-9C2605A29F52=watt,name=Power,format=FLOAT,unit=W ' +
        '4648454d-0101-686F-6D65-627269646765=vol,name=xVolume,format=UINT8,unit=PERCENTAGE,cmd=vol,minValue=0,maxValue=100 ' +
        'Voltage=volt,name=Spannung,format=FLOAT',
    },
  },

  // clear for one characteristic
  {
    name: 'e2e_m_clear',
    setList: 'on off pct:slider,0,1,100',
    readingList: 'pct',
    readings: { state: 'on', pct: '50' },
    attributes: { homebridgeMapping: 'Brightness=clear' },
  },

  // the name of another characteristic copies its mapping
  {
    name: 'e2e_m_copy',
    setList: 'pos',
    readingList: 'pos',
    readings: { state: 'ok', level: '10' },
    attributes: { genericDeviceType: 'blind', homebridgeMapping: 'CurrentPosition=level TargetPosition=CurrentPosition,cmd=pos' },
  },

  // the JSON form, with functions as text
  {
    name: 'e2e_m_json',
    setList: 'ein aus helligkeit',
    readingList: 'helligkeit',
    readings: { state: 'x', schalter: 'ein', helligkeit: '128' },
    attributes: {
      genericDeviceType: 'light',
      homebridgeMapping: JSON.stringify({
        On: { reading: 'schalter', valueOn: 'ein', cmdOn: 'ein', cmdOff: 'aus' },
        Brightness: {
          reading: 'helligkeit',
          cmd: 'helligkeit',
          delay: true,
          reading2homekit: '{return Math.round(orig/2.55)}',
          homekit2reading: '{return Math.round(orig*2.55)}',
        },
      }),
    },
  },

  // functions from the jsFunctions file of the platform
  {
    name: 'e2e_m_functions',
    setList: 'on off level',
    readingList: 'level',
    readings: { state: 'on', level: '128' },
    attributes: { genericDeviceType: 'light', homebridgeMapping: 'Brightness=level::level,reading2homekit=byteToPercent,homekit2reading=percentToByte' },
  },

  // functions that fail
  {
    name: 'e2e_m_failing',
    setList: 'on off level',
    readingList: 'level',
    readings: { state: 'on', level: '128' },
    attributes: { genericDeviceType: 'light', homebridgeMapping: 'Brightness=level::level,reading2homekit=fails,homekit2reading=fails' },
  },

  // mappings for the accessory information
  {
    name: 'e2e_m_info',
    setList: 'on off',
    readings: { state: 'on', fw: '2.0.1' },
    attributes: { homebridgeMapping: 'AccessoryCategory=FAN SerialNumber=serial=ABC123 Manufacturer=value=ACME FirmwareRevision=fw' },
  },

  // entries the parser can not read, and one that is commented out
  {
    name: 'e2e_m_syntax',
    setList: 'on off',
    readings: { state: 'on' },
    attributes: { homebridgeMapping: 'On=cmdOn=an nonsense #On=cmdOn=never On=a=b=c' },
  },
];

let world: World;

beforeAll(async () => {
  world = await startWorld(devices, { room: 'e2e_mappings', platform: { jsFunctions: 'functions.cjs' }, files: { 'functions.cjs': functions } });
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

describe('what homebridge publishes', () => {
  it.each<[string, TypeName, string | undefined, TypeName, number]>([
    // the range of the reading is cut to minValue and maxValue
    ['e2e_m_thermostat', 'Thermostat', undefined, 'TargetTemperature', 20],
    // the reading of another device
    ['e2e_m_thermostat', 'Thermostat', undefined, 'CurrentTemperature', 18.5],
    ['e2e_m_thermostat', 'Thermostat', undefined, 'TargetHeatingCoolingState', 3],
    // 55 matches the regular expression that maps to `#`
    ['e2e_m_light', 'Lightbulb', undefined, 'Brightness', 55],
    ['e2e_m_hub', 'Switch', 'TV', 'On', 1],
    ['e2e_m_hub', 'Switch', 'DVD', 'On', 0],
    ['e2e_m_hub', 'Switch', 'Off', 'On', 0],
    // there is no reading, so the default
    ['e2e_m_button', 'Switch', undefined, 'On', 0],
    // 100 times the factor 0.5
    ['e2e_m_scaled', 'Lightbulb', undefined, 'Brightness', 50],
    // 500 of 1000, scaled to 359
    ['e2e_m_scaled', 'Lightbulb', undefined, 'Hue', 180],
    // 200 between 140 and 500, inverted
    ['e2e_m_scaled', 'Lightbulb', undefined, 'ColorTemperature', 440],
    // 30, inverted
    ['e2e_m_blind', 'WindowCovering', undefined, 'CurrentPosition', 70],
    ['e2e_m_blind', 'WindowCovering', undefined, 'TargetPosition', 70],
    // the second and the fourth word of `T: 21.5 H: 60`
    ['e2e_m_parts', 'TemperatureSensor', undefined, 'CurrentTemperature', 21.5],
    ['e2e_m_parts', 'TemperatureSensor', undefined, 'CurrentRelativeHumidity', 60],
    // 150 is above the threshold
    ['e2e_m_motion', 'MotionSensor', undefined, 'MotionDetected', 1],
    ['e2e_m_nocache', 'TemperatureSensor', undefined, 'CurrentTemperature', 15],
    ['e2e_m_multi', 'Switch', undefined, 'On', 1],
    ['e2e_m_multi', 'BatteryService', undefined, 'BatteryLevel', 80],
    ['e2e_m_multi', 'BatteryService', undefined, 'StatusLowBattery', 0],
    ['e2e_m_multi', 'BatteryService', undefined, 'ChargingState', 1],
    ['e2e_m_multi', 'TemperatureSensor', 'innen', 'CurrentTemperature', 21.5],
    ['e2e_m_multi', 'TemperatureSensor', 'aussen', 'CurrentTemperature', -3],
    ['e2e_m_tv', 'Television', undefined, 'Active', 1],
    ['e2e_m_tv', 'Television', undefined, 'ActiveIdentifier', 2],
    ['e2e_m_tv', 'InputSource', 'hdmi1 - e2e_m_tv', 'Identifier', 1],
    ['e2e_m_tv', 'InputSource', 'hdmi2 - e2e_m_tv', 'Identifier', 2],
    ['e2e_m_custom', 'Switch', undefined, 'Power', 17.5],
    ['e2e_m_custom', 'Switch', undefined, 'xVolume', 30],
    ['e2e_m_custom', 'Switch', undefined, 'Voltage', 229],
    ['e2e_m_copy', 'WindowCovering', undefined, 'CurrentPosition', 10],
    ['e2e_m_copy', 'WindowCovering', undefined, 'TargetPosition', 10],
    ['e2e_m_json', 'Lightbulb', undefined, 'On', 1],
    // 128 of 255, by the function in the mapping
    ['e2e_m_json', 'Lightbulb', undefined, 'Brightness', 50],
    // 128 of 255, by the function from the file
    ['e2e_m_functions', 'Lightbulb', undefined, 'Brightness', 50],
  ])('shows %s in %s (%s) %s as %d', (device, service, name, type, value) => {
    expect(Number(world.named(device, service, type, name).value)).toBe(value);
  });

  it('shows minValue, maxValue and minStep of a mapping as the range of the characteristic', () => {
    expect(world.named('e2e_m_thermostat', 'Thermostat', 'TargetTemperature')).toMatchObject({ minValue: 18, maxValue: 25, minStep: 0.5 });
    expect(world.named('e2e_m_scaled', 'Lightbulb', 'Hue')).toMatchObject({ minValue: 0, maxValue: 359 });
    expect(world.named('e2e_m_scaled', 'Lightbulb', 'ColorTemperature')).toMatchObject({ minValue: 140, maxValue: 500 });
  });

  it('offers only the values a mapping lists as valid', () => {
    expect(world.named('e2e_m_thermostat', 'Thermostat', 'TargetHeatingCoolingState')['valid-values']).toEqual([1, 3]);
  });

  it('gives a device one service per subtype', () => {
    const names = world
      .accessory('e2e_m_hub')
      .services.filter((service) => service.type === hapType.Switch)
      .map((service) => service.characteristics.find((characteristic) => characteristic.type === hapType.Name)?.value);

    expect(names).toEqual(['TV', 'DVD', 'Off']);
  });

  it('gives a device the services its mappings name, next to its own', () => {
    expect(servicesByName(world.accessories).e2e_m_multi).toEqual([
      hapType.Switch,
      hapType.BatteryService,
      hapType.TemperatureSensor,
      hapType.TemperatureSensor,
    ]);
    expect(world.characteristicsOf('e2e_m_multi', hapType.BatteryService)).toEqual([hapType.StatusLowBattery, hapType.BatteryLevel, hapType.ChargingState]);
  });

  it('links services to the service linkedTo names', () => {
    const inputs = world.accessory('e2e_m_tv').services.filter((service) => service.type === hapType.InputSource);

    expect(inputs).toHaveLength(2);
    expect(world.service('e2e_m_tv', hapType.Television).linked).toEqual(inputs.map((service) => service.iid));
  });

  it('creates a characteristic HomeKit does not define from its uuid, name, format and unit', () => {
    expect(world.named('e2e_m_custom', 'Switch', 'Power')).toMatchObject({ description: 'Power', format: 'float', unit: 'W', perms: ['pr', 'ev'] });
    // a mapping with a command can be written
    expect(world.named('e2e_m_custom', 'Switch', 'xVolume')).toMatchObject({
      description: 'xVolume',
      format: 'uint8',
      unit: 'percentage',
      minValue: 0,
      maxValue: 100,
      perms: ['pr', 'pw', 'ev'],
    });
    // the uuid is known to the plugin by the name Voltage
    expect(world.named('e2e_m_custom', 'Switch', 'Voltage')).toMatchObject({ description: 'Spannung', format: 'float' });
  });

  it('leaves out a characteristic that is cleared, and keeps the others of the detection', () => {
    expect(world.characteristicsOf('e2e_m_clear', hapType.Lightbulb)).toEqual([hapType.On]);
  });

  it('asks fhem for the reading of another device when it starts', () => {
    expect(logged(/executing: .*ReadingsVal\(%22e2e_m_other%22%2C%22temperature%22/).length).toBeGreaterThan(0);
  });

  it('shows a firmware revision mapping at the accessory information', () => {
    expect(world.named('e2e_m_info', 'AccessoryInformation', 'FirmwareRevision').value).toBe('2.0.1');
  });

  it('shows the text of a manufacturer and a serial number mapping at the accessory information', () => {
    expect(world.named('e2e_m_info', 'AccessoryInformation', 'Manufacturer').value).toBe('ACME');
    expect(world.named('e2e_m_info', 'AccessoryInformation', 'SerialNumber').value).toBe('ABC123');
  });

  it('keeps the mappings for the accessory information off the switch, and answers a read of the firmware revision once', async () => {
    expect(world.characteristicsOf('e2e_m_info', hapType.Switch)).toEqual([hapType.On]);

    expect(await world.homebridge.read(world.named('e2e_m_info', 'AccessoryInformation', 'FirmwareRevision'))).toBe('2.0.1');
    expect(logged(/This callback function has already been called|threw an error from the characteristic/)).toEqual([]);
  });

  it('takes the accessory category a mapping names', () => {
    expect(logged(/using category: 3 \(FAN\)/)).toHaveLength(1);
    expect(logged(/unknown category/)).toEqual([]);
  });

  it('reports the entries of a mapping it can not read and goes on with the others', () => {
    expect(logged(/wrong syntax: /).map((line) => line.replace(/^.*wrong syntax: /, ''))).toEqual(['nonsense', 'a=b=c']);
    expect(world.characteristicsOf('e2e_m_syntax', hapType.Switch)).toEqual([hapType.On]);
  });
});

describe('a read of a characteristic', () => {
  const asked = (device: string) => logged(new RegExp(`executing: .*ReadingsVal\\(%22${device}%22`)).length;

  it('is answered from what the plugin has seen, and fhem is asked in the background once a minute at most', async () => {
    const temperature = world.named('e2e_m_parts', 'TemperatureSensor', 'CurrentTemperature');
    // homebridge read every characteristic when it listed the accessories, which was the first read of this minute
    const before = asked('e2e_m_parts');
    expect(before).toBeGreaterThan(0);

    expect(await world.homebridge.read(temperature)).toBe(21.5);
    expect(await world.homebridge.read(temperature)).toBe(21.5);
    // one more if the minute happened to be over
    expect(asked('e2e_m_parts')).toBeLessThanOrEqual(before + 1);
  });

  it('is answered with an error when the function that converts the reading fails', async () => {
    expect(await world.homebridge.read(world.named('e2e_m_failing', 'Lightbulb', 'Brightness'))).toBeUndefined();
    expect(logged(/e2e_m_failing-level reading2homekit: Error: boom/).length).toBeGreaterThan(0);
  });

  it('asks fhem every time for a mapping with nocache', async () => {
    const before = asked('e2e_m_nocache');

    expect(await world.homebridge.read(world.named('e2e_m_nocache', 'TemperatureSensor', 'CurrentTemperature'))).toBe(15);
    expect(asked('e2e_m_nocache')).toBe(before + 1);
  });
});

describe('a value HomeKit writes', () => {
  it.each<[string, TypeName, string | undefined, TypeName, number | boolean, string, string, string]>([
    ['e2e_m_thermostat', 'Thermostat', undefined, 'TargetTemperature', 22.5, 'target 22.5', 'target', '22.5'],
    // cmds, with + for the blank
    ['e2e_m_thermostat', 'Thermostat', undefined, 'TargetHeatingCoolingState', 1, 'mode manual', 'mode', 'manual'],
    ['e2e_m_light', 'Lightbulb', undefined, 'Brightness', 100, 'level full', 'level', 'full'],
    // a single digit matches the regular expression in cmds
    ['e2e_m_light', 'Lightbulb', undefined, 'Brightness', 5, 'level low', 'level', 'low'],
    // nothing in cmds matches, so the command of the mapping with the value
    ['e2e_m_light', 'Lightbulb', undefined, 'Brightness', 42, 'level 42', 'level', '42'],
    ['e2e_m_hub', 'Switch', 'DVD', 'On', true, 'activity DVD', 'activity', 'DVD'],
    ['e2e_m_hub', 'Switch', 'TV', 'On', false, 'off', 'state', 'off'],
    // a mapping with only cmd gets the value appended as it comes from HomeKit
    ['e2e_m_hub', 'Switch', 'Off', 'On', true, 'off true', 'state', 'off true'],
    // divided by the factor
    ['e2e_m_scaled', 'Lightbulb', undefined, 'Brightness', 80, 'raw 160', 'raw', '160'],
    // 90 of 359, scaled to 1000
    ['e2e_m_scaled', 'Lightbulb', undefined, 'Hue', 90, 'tint 251', 'tint', '251'],
    ['e2e_m_scaled', 'Lightbulb', undefined, 'ColorTemperature', 300, 'ct 340', 'ct', '340'],
    ['e2e_m_blind', 'WindowCovering', undefined, 'TargetPosition', 80, 'pct 20', 'pct', '20'],
    ['e2e_m_suffix', 'Switch', undefined, 'On', true, 'on 5', 'state', 'on 5'],
    ['e2e_m_tv', 'Television', undefined, 'ActiveIdentifier', 1, 'input hdmi1', 'input', 'hdmi1'],
    ['e2e_m_tv', 'Television', undefined, 'Active', 0, 'power off', 'power', 'off'],
    ['e2e_m_custom', 'Switch', undefined, 'xVolume', 40, 'vol 40', 'vol', '40'],
    // the copy of the mapping of CurrentPosition, with the command that was added to it
    ['e2e_m_copy', 'WindowCovering', undefined, 'TargetPosition', 40, 'pos 40', 'pos', '40'],
    ['e2e_m_json', 'Lightbulb', undefined, 'On', true, 'ein', 'state', 'ein'],
    // by the functions of the mapping and of the file
    ['e2e_m_json', 'Lightbulb', undefined, 'Brightness', 80, 'helligkeit 204', 'helligkeit', '204'],
    ['e2e_m_functions', 'Lightbulb', undefined, 'Brightness', 80, 'level 204', 'level', '204'],
  ])('to %s %s (%s) %s as %s reaches fhem as: set %s', async (device, service, name, type, value, command, reading, expected) => {
    await world.homebridge.write(world.named(device, service, type, name), value);

    await world.fhem.wasSet(device, command, reading, expected);
  });

  it('is sent once, with the last of the values that came within the delay', async () => {
    const brightness = world.named('e2e_m_delay', 'Lightbulb', 'Brightness');

    for (const value of [10, 20, 30]) {
      await world.homebridge.write(brightness, value);
    }
    await world.fhem.wasSet('e2e_m_delay', 'bright 30', 'bright', '30');

    expect(logged(/e2e-m-delay delaying command Brightness/)).toHaveLength(3);
    expect(logged(/executing: .*set%20e2e_m_delay%20bright/)).toHaveLength(1);
  });

  it('falls back to the default after the timeout, like a push button', async () => {
    const on = world.named('e2e_m_button', 'Switch', 'On');
    const before = world.homebridge.notifications().length;

    await world.notifies(on, 0, async () => {
      await world.homebridge.write(on, true);
      await world.fhem.wasSet('e2e_m_button', 'press', 'state', 'press');
    });

    const told = world.homebridge
      .notifications()
      .slice(before)
      .filter((notification) => notification.aid === on.aid && notification.iid === on.iid)
      .map((notification) => Number(notification.value));
    // pressed, and released half a second later
    expect(told.sort((a, b) => a - b)).toEqual([0, 1]);
  });

  it('is not sent when the function that converts it fails', async () => {
    await world.homebridge.write(world.named('e2e_m_failing', 'Lightbulb', 'Brightness'), 80);

    await eventually(
      'the plugin to report the failure',
      () => (logged(/e2e_m_failing-level homekit2reading: Error: boom/).length ? true : undefined),
      world.homebridge,
    );
    expect(logged(/executing: .*set%20e2e_m_failing/)).toEqual([]);
  });

  it('is not sent for a readOnly mapping', async () => {
    await world.homebridge.write(world.named('e2e_m_readonly', 'Switch', 'On'), true);

    await eventually(
      'the plugin to log that it sends nothing',
      () => (logged(/e2e-m-readonly NOT sending command \S+ with value (true|1) for readOnly characteristic/).length ? true : undefined),
      world.homebridge,
    );
    expect(logged(/executing: .*set%20e2e_m_readonly/)).toEqual([]);
  });
});

describe('a reading that changes in fhem', () => {
  it.each<[string, string, string, string, TypeName, string | undefined, TypeName, number]>([
    // the thermostat shows the temperature of the other device
    ['e2e_m_other', 'temperature', '17', 'e2e_m_thermostat', 'Thermostat', undefined, 'CurrentTemperature', 17],
    // cut to maxValue
    ['e2e_m_thermostat', 'target', '30', 'e2e_m_thermostat', 'Thermostat', undefined, 'TargetTemperature', 25],
    // rounded to minStep
    ['e2e_m_thermostat', 'target', '21.3', 'e2e_m_thermostat', 'Thermostat', undefined, 'TargetTemperature', 21.5],
    ['e2e_m_thermostat', 'mode', 'auto', 'e2e_m_thermostat', 'Thermostat', undefined, 'TargetHeatingCoolingState', 3],
    // not in values, so the default
    ['e2e_m_thermostat', 'mode', 'boost', 'e2e_m_thermostat', 'Thermostat', undefined, 'TargetHeatingCoolingState', 1],
    ['e2e_m_light', 'level', 'full', 'e2e_m_light', 'Lightbulb', undefined, 'Brightness', 100],
    ['e2e_m_light', 'level', 'low', 'e2e_m_light', 'Lightbulb', undefined, 'Brightness', 10],
    ['e2e_m_light', 'level', '7', 'e2e_m_light', 'Lightbulb', undefined, 'Brightness', 7],
    ['e2e_m_hub', 'activity', 'TV', 'e2e_m_hub', 'Switch', 'TV', 'On', 1],
    // valueOn as a regular expression
    ['e2e_m_hub', 'activity', 'Watch DVD', 'e2e_m_hub', 'Switch', 'DVD', 'On', 1],
    ['e2e_m_hub', 'activity', 'PowerOff', 'e2e_m_hub', 'Switch', 'DVD', 'On', 0],
    ['e2e_m_scaled', 'raw', '40', 'e2e_m_scaled', 'Lightbulb', undefined, 'Brightness', 20],
    ['e2e_m_scaled', 'tint', '1000', 'e2e_m_scaled', 'Lightbulb', undefined, 'Hue', 359],
    ['e2e_m_scaled', 'ct', '500', 'e2e_m_scaled', 'Lightbulb', undefined, 'ColorTemperature', 140],
    ['e2e_m_blind', 'pct', '100', 'e2e_m_blind', 'WindowCovering', undefined, 'CurrentPosition', 0],
    ['e2e_m_parts', 'measurement', 'T: 19.5 H: 60', 'e2e_m_parts', 'TemperatureSensor', undefined, 'CurrentTemperature', 19.5],
    ['e2e_m_parts', 'measurement', 'T: 19.5 H: 65', 'e2e_m_parts', 'TemperatureSensor', undefined, 'CurrentRelativeHumidity', 65],
    ['e2e_m_motion', 'movement', '50', 'e2e_m_motion', 'MotionSensor', undefined, 'MotionDetected', 0],
    ['e2e_m_nocache', 'temp2', '16.5', 'e2e_m_nocache', 'TemperatureSensor', undefined, 'CurrentTemperature', 16.5],
    ['e2e_m_multi', 'akku', '10', 'e2e_m_multi', 'BatteryService', undefined, 'StatusLowBattery', 1],
    ['e2e_m_multi', 'akku', '45', 'e2e_m_multi', 'BatteryService', undefined, 'BatteryLevel', 45],
    ['e2e_m_multi', 'charging', 'no', 'e2e_m_multi', 'BatteryService', undefined, 'ChargingState', 0],
    ['e2e_m_multi', 'temperature2', '-12.5', 'e2e_m_multi', 'TemperatureSensor', 'aussen', 'CurrentTemperature', -12.5],
    ['e2e_m_tv', 'input', 'hdmi2', 'e2e_m_tv', 'Television', undefined, 'ActiveIdentifier', 2],
    ['e2e_m_tv', 'power', 'on', 'e2e_m_tv', 'Television', undefined, 'Active', 1],
    ['e2e_m_custom', 'watt', '20.5', 'e2e_m_custom', 'Switch', undefined, 'Power', 20.5],
    ['e2e_m_custom', 'vol', '55', 'e2e_m_custom', 'Switch', undefined, 'xVolume', 55],
    ['e2e_m_custom', 'volt', '231', 'e2e_m_custom', 'Switch', undefined, 'Voltage', 231],
    ['e2e_m_copy', 'level', '70', 'e2e_m_copy', 'WindowCovering', undefined, 'TargetPosition', 70],
    ['e2e_m_json', 'schalter', 'aus', 'e2e_m_json', 'Lightbulb', undefined, 'On', 0],
    ['e2e_m_json', 'helligkeit', '255', 'e2e_m_json', 'Lightbulb', undefined, 'Brightness', 100],
    ['e2e_m_functions', 'level', '255', 'e2e_m_functions', 'Lightbulb', undefined, 'Brightness', 100],
  ])('%s %s = %s is told to HomeKit as %s %s (%s) %s = %d', async (source, reading, value, device, service, name, type, expected) => {
    const target = world.named(device, service, type, name);

    await world.notifies(target, expected, () => world.fhem.change(source, reading, value));
    await world.becomes(target, expected);
  });

  it('is reported once when the values of the mapping do not cover it, and changes nothing', async () => {
    const brightness = world.named('e2e_m_light', 'Lightbulb', 'Brightness');
    const reported = () => logged(/e2e_m_light-level value broken not handled in values/).length;

    await world.fhem.change('e2e_m_light', 'level', 'broken');
    await eventually('the plugin to report the value', () => (reported() ? true : undefined), world.homebridge);
    expect(await world.homebridge.read(brightness)).toBe(7);

    // the same value arrives again after another one
    await world.notifies(brightness, 8, () => world.fhem.change('e2e_m_light', 'level', '8'));
    await world.fhem.change('e2e_m_light', 'level', 'broken');
    await world.notifies(brightness, 9, () => world.fhem.change('e2e_m_light', 'level', '9'));
    expect(reported()).toBe(1);
  });
});
