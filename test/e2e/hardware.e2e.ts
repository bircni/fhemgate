// device types that only exist with their hardware or with another module of fhem, and what
// the eventMap attribute does. the stand-in serves them as fhem would list them, so these
// tests do not run against a real fhem.
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { fixtureDevices } from '../support/devices.ts';
import type { FhemDevice } from '../support/types.ts';
import { asJsonlist2, realFhemUrl, type StandIn } from './fhem.ts';
import { eveType, hapType, type TypeName } from './homebridge.ts';
import { eventually, startStandInWorld, type World } from './world.ts';

/** the device of a fixture, as fhem lists it */
function fixture(id: string, change: (device: FhemDevice) => void = () => {}): FhemDevice {
  const found = fixtureDevices().find((candidate) => candidate.id === id);
  if (!found) {
    throw new Error(`there is no fixture ${id}`);
  }
  const device = found.load();
  change(device);
  return device;
}

const devices: FhemDevice[] = [
  fixture('presence/presence'),
  fixture('presence/roommate'),
  fixture('presence/residents'),
  fixture('media/sonosplayer'),
  fixture('media/harmony-hub'),
  // with the colour temperature as a characteristic, so that the plugin listens to the ct reading
  fixture('color/hue-color-xy', (device) => {
    device.Attributes.homebridgeMapping = 'CT=ct,name=CT,format=UINT16';
  }),
  fixture('color/wifilight-hsv'),
  fixture('color/milight-rgbw'),
  fixture('blind/somfy'),
  fixture('blind/duofern'),
  fixture('thermostat/max-heating'),
  fixture('thermostat/pid20'),
  fixture('thermostat/comet-dect'),
  fixture('sensor/cul_fhttk'),
  fixture('sensor/max-shuttercontact'),
  fixture('sensor/power-meter'),
  fixture('sensor/hm-sen-li-o'),
  fixture('sensor/co20-voc'),
  fixture('sensor/luminosity'),
  fixture('switch/fs20-eventmap'),

  // the eventMap attribute, for a mapping with values and for one that says by itself that it is an On
  asJsonlist2({
    name: 'e2e_hw_eventmap',
    readings: { state: 'zu' },
    attributes: {
      genericDeviceType: 'ContactSensor',
      eventMap: 'auf:on zu:off',
      homebridgeMapping: 'ContactSensorState=state,values=on:CONTACT_NOT_DETECTED;off:CONTACT_DETECTED',
    },
  }),
  // a light that is set with rgb and also reports its colour as xy
  asJsonlist2({
    name: 'e2e_hw_xy',
    setList: 'on off rgb:colorpicker,RGB',
    readingList: 'rgb',
    readings: { state: 'on', rgb: 'FF0000', colormode: 'hs', xy: '0.6,0.3' },
  }),
  asJsonlist2({
    name: 'e2e_hw_on',
    readings: { state: 'A0' },
    attributes: { genericDeviceType: 'switch', eventMap: 'I:on O:off', homebridgeMapping: 'clear On=state,On=1,cmdOn=an,cmdOff=aus' },
  }),
];

describe.skipIf(realFhemUrl !== undefined)('devices of other fhem modules', () => {
  let world: World & { fhem: StandIn };

  beforeAll(async () => {
    world = await startStandInWorld(devices);
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
      ['presence', 'OccupancySensor', undefined, 'OccupancyDetected', 1],
      ['roommate', 'OccupancySensor', undefined, 'OccupancyDetected', 1],
      // the residents are a security system: gotosleep is NIGHT_ARM
      ['residents', 'SecuritySystem', undefined, 'SecuritySystemCurrentState', 2],
      ['residents', 'SecuritySystem', undefined, 'SecuritySystemTargetState', 2],
      ['sonosplayer', 'Switch', undefined, 'On', 1],
      ['sonosplayer', 'Switch', undefined, 'Volume', 18],
      // one switch per activity of the hub
      ['harmony_hub', 'Switch', 'TV', 'On', 1],
      ['harmony_hub', 'Switch', 'Musik', 'On', 0],
      ['harmony_hub', 'Switch', 'PowerOff', 'On', 0],
      ['hue_color_xy', 'Lightbulb', undefined, 'On', 1],
      ['hue_color_xy', 'Lightbulb', undefined, 'Brightness', 100],
      ['hue_color_xy', 'Lightbulb', undefined, 'Hue', 46],
      ['hue_color_xy', 'Lightbulb', undefined, 'Saturation', 55],
      ['wifilight_hsv', 'Lightbulb', undefined, 'Hue', 240],
      ['wifilight_hsv', 'Lightbulb', undefined, 'Saturation', 80],
      ['wifilight_hsv', 'Lightbulb', undefined, 'Brightness', 60],
      ['milight_rgbw', 'Lightbulb', undefined, 'Brightness', 100],
      ['milight_rgbw', 'Lightbulb', undefined, 'Hue', 120],
      // SOMFY and DUOFERN count the other way round
      ['somfy', 'WindowCovering', undefined, 'CurrentPosition', 100],
      ['duofern', 'WindowCovering', undefined, 'CurrentPosition', 70],
      ['duofern', 'WindowCovering', undefined, 'PositionState', 2],
      ['max_heating', 'Thermostat', undefined, 'TargetTemperature', 21],
      ['max_heating', 'Thermostat', undefined, 'CurrentTemperature', 20.3],
      ['max_heating', 'Thermostat', undefined, 'Actuation', 42],
      ['max_heating', 'Thermostat', undefined, 'StatusLowBattery', 0],
      ['pid20', 'Thermostat', undefined, 'TargetTemperature', 21.5],
      ['pid20', 'Thermostat', undefined, 'CurrentTemperature', 20.9],
      ['pid20', 'Thermostat', undefined, 'Actuation', 37],
      // a Comet DECT reports what it is set to as its temperature
      ['comet_dect', 'Thermostat', undefined, 'TargetTemperature', 21.5],
      ['comet_dect', 'Thermostat', undefined, 'BatteryLevel', 80],
      ['cul_fhttk', 'ContactSensor', undefined, 'ContactSensorState', 0],
      ['max_shuttercontact', 'ContactSensor', undefined, 'ContactSensorState', 0],
      ['max_shuttercontact', 'ContactSensor', undefined, 'StatusLowBattery', 1],
      // the HomeMatic power meter reports milliampere and watt hours
      ['power_meter', 'Switch', undefined, 'Current', 0.185],
      ['power_meter', 'Switch', undefined, 'Energy', 1.2345],
      ['power_meter', 'Switch', undefined, 'Power', 42.5],
      ['hm_sen_li_o', 'LightSensor', undefined, 'CurrentAmbientLightLevel', 1200.5],
      ['co20_voc', 'AirQualitySensor', undefined, 'AirQuality', 3],
      // the eventMap of the device says that B0 means off
      ['fs20_eventmap', 'Switch', undefined, 'On', 0],
      ['e2e_hw_eventmap', 'ContactSensor', undefined, 'ContactSensorState', 0],
      // A0 is how FS20 says off
      ['e2e_hw_on', 'Switch', undefined, 'On', 0],
    ])('shows %s in %s (%s) %s as %d', (device, service, name, type, value) => {
      expect(Number(world.named(device, service, type, name).value)).toBe(value);
    });

    it('converts luminosity to lux', () => {
      expect(world.named('luminosity', 'LightSensor', 'CurrentAmbientLightLevel').value).toBeCloseTo(200);
    });

    it('takes the range of the target temperature of a MAX thermostat from its set command', () => {
      expect(world.named('max_heating', 'Thermostat', 'TargetTemperature')).toMatchObject({ minValue: 5, maxValue: 30, minStep: 0.5 });
    });
  });

  describe('a read of the volume of a SONOS player', () => {
    it('asks fhem, as the player does not send events for it', async () => {
      const volume = world.fhem.fake.options.devices?.find((device) => device.Internals.NAME === 'sonosplayer')?.Readings.Volume;
      if (volume) {
        // changed without an event
        volume.Value = '33';
      }

      expect(await world.homebridge.read(world.named('sonosplayer', 'Switch', 'Volume'))).toBe(33);
      expect(world.fhem.fake.commands).toContain('{ReadingsVal("sonosplayer","Volume","")}');
    });
  });

  describe('a value HomeKit writes', () => {
    it.each<[string, TypeName, string | undefined, TypeName, number | boolean, string]>([
      ['residents', 'SecuritySystem', undefined, 'SecuritySystemTargetState', 1, 'absent'],
      ['residents', 'SecuritySystem', undefined, 'SecuritySystemTargetState', 3, 'home'],
      ['sonosplayer', 'Switch', undefined, 'On', false, 'pause'],
      ['sonosplayer', 'Switch', undefined, 'On', true, 'play'],
      ['sonosplayer', 'Switch', undefined, 'Volume', 40, 'Volume 40'],
      ['harmony_hub', 'Switch', 'Musik', 'On', true, 'activity Musik'],
      ['harmony_hub', 'Switch', 'TV', 'On', false, 'off'],
      ['hue_color_xy', 'Lightbulb', undefined, 'Brightness', 50, 'pct 50'],
      ['hue_color_xy', 'Lightbulb', undefined, 'Hue', 180, 'hue 32859'],
      // a WifiLight is set with hue, saturation and brightness in one command
      ['wifilight_hsv', 'Lightbulb', undefined, 'Hue', 120, 'HSV 120,80,60'],
      ['wifilight_hsv', 'Lightbulb', undefined, 'Saturation', 50, 'HSV 120,50,60'],
      ['wifilight_hsv', 'Lightbulb', undefined, 'Brightness', 30, 'HSV 120,50,30'],
      ['milight_rgbw', 'Lightbulb', undefined, 'Brightness', 40, 'dim 40'],
      ['milight_rgbw', 'Lightbulb', undefined, 'Hue', 200, 'hue 200'],
      ['milight_rgbw', 'Lightbulb', undefined, 'Saturation', 30, 'saturation 30'],
      ['somfy', 'WindowCovering', undefined, 'TargetPosition', 30, 'pos 70'],
      ['duofern', 'WindowCovering', undefined, 'TargetPosition', 60, 'position 40'],
      ['max_heating', 'Thermostat', undefined, 'TargetTemperature', 22, 'desiredTemperature 22'],
      ['pid20', 'Thermostat', undefined, 'TargetTemperature', 22, 'desired 22'],
      ['comet_dect', 'Thermostat', undefined, 'TargetTemperature', 23, 'desired-temp 23'],
      ['e2e_hw_on', 'Switch', undefined, 'On', true, 'an'],
    ])('to %s %s (%s) %s as %s reaches fhem as: set %s', async (device, service, name, type, value, command) => {
      await world.homebridge.write(world.named(device, service, type, name), value);

      await world.fhem.wasTold(`set ${device} ${command}`);
    });

    // the blank after the device is missing.
    it('to identify a HUEDevice sends a command fhem can not make sense of', async () => {
      await world.homebridge.write(world.named('hue_color_xy', 'AccessoryInformation', 'Identify'), true);

      await world.fhem.wasTold('set hue_color_xyalert select');
    });
  });

  describe('a reading that changes in fhem', () => {
    it.each<[string, string, string, TypeName, string | undefined, TypeName, number]>([
      ['presence', 'state', 'absent', 'OccupancySensor', undefined, 'OccupancyDetected', 0],
      ['roommate', 'presence', 'absent', 'OccupancySensor', undefined, 'OccupancyDetected', 0],
      ['residents', 'state', 'gone', 'SecuritySystem', undefined, 'SecuritySystemCurrentState', 1],
      ['residents', 'state', 'absent', 'SecuritySystem', undefined, 'SecuritySystemTargetState', 0],
      ['sonosplayer', 'transportState', 'PAUSED_PLAYBACK', 'Switch', undefined, 'On', 0],
      ['harmony_hub', 'activity', 'PowerOff', 'Switch', 'PowerOff', 'On', 1],
      ['harmony_hub', 'activity', 'TV', 'Switch', 'TV', 'On', 1],
      // bri 200 of 254
      ['hue_color_xy', 'bri', '200', 'Lightbulb', undefined, 'Brightness', 79],
      ['hue_color_xy', 'hue', '0', 'Lightbulb', undefined, 'Hue', 0],
      ['hue_color_xy', 'sat', '254', 'Lightbulb', undefined, 'Saturation', 100],
      ['hue_color_xy', 'onoff', '0', 'Lightbulb', undefined, 'On', 0],
      ['wifilight_hsv', 'hue', '0', 'Lightbulb', undefined, 'Hue', 0],
      ['milight_rgbw', 'brightness', '10', 'Lightbulb', undefined, 'Brightness', 10],
      ['somfy', 'position', '100', 'WindowCovering', undefined, 'CurrentPosition', 0],
      ['duofern', 'position', '100', 'WindowCovering', undefined, 'CurrentPosition', 0],
      ['duofern', 'moving', 'up', 'WindowCovering', undefined, 'PositionState', 1],
      // off and on are what a MAX thermostat calls its lowest and highest temperature, cut to its range
      ['max_heating', 'desiredTemperature', 'off', 'Thermostat', undefined, 'TargetTemperature', 5],
      ['max_heating', 'desiredTemperature', 'on', 'Thermostat', undefined, 'TargetTemperature', 30],
      ['max_heating', 'valveposition', '80', 'Thermostat', undefined, 'Actuation', 80],
      ['max_heating', 'battery', 'low', 'Thermostat', undefined, 'StatusLowBattery', 1],
      ['pid20', 'measured', '19.8', 'Thermostat', undefined, 'CurrentTemperature', 19.8],
      ['pid20', 'desired', '20', 'Thermostat', undefined, 'TargetTemperature', 20],
      ['pid20', 'actuation', '55', 'Thermostat', undefined, 'Actuation', 55],
      ['comet_dect', 'temperature', '19.5', 'Thermostat', undefined, 'TargetTemperature', 19.5],
      ['cul_fhttk', 'Window', 'Open', 'ContactSensor', undefined, 'ContactSensorState', 1],
      ['cul_fhttk', 'Window', 'Closed', 'ContactSensor', undefined, 'CurrentDoorState', 1],
      ['max_shuttercontact', 'state', 'opened', 'ContactSensor', undefined, 'ContactSensorState', 1],
      ['power_meter', 'current', '500', 'Switch', undefined, 'Current', 0.5],
      ['power_meter', 'energy', '2000', 'Switch', undefined, 'Energy', 2],
      ['hm_sen_li_o', 'brightness', '55.5', 'LightSensor', undefined, 'CurrentAmbientLightLevel', 55.5],
      // 1600 ppm is POOR
      ['co20_voc', 'voc', '1600', 'AirQualitySensor', undefined, 'AirQuality', 5],
      ['fs20_eventmap', 'state', 'BI', 'Switch', undefined, 'On', 1],
      ['fs20_eventmap', 'state', 'B0', 'Switch', undefined, 'On', 0],
      // toggle is not on or off, so the eventMap is not used for it
      ['fs20_eventmap', 'state', 'B1', 'Switch', undefined, 'On', 1],
      ['e2e_hw_eventmap', 'state', 'auf', 'ContactSensor', undefined, 'ContactSensorState', 1],
      ['e2e_hw_eventmap', 'state', 'zu', 'ContactSensor', undefined, 'ContactSensorState', 0],
      ['e2e_hw_on', 'state', 'O', 'Switch', undefined, 'On', 0],
      ['e2e_hw_on', 'state', 'I', 'Switch', undefined, 'On', 1],
      ['e2e_hw_on', 'state', '000000', 'Switch', undefined, 'On', 0],
      ['e2e_hw_on', 'state', 'on', 'Switch', undefined, 'On', 1],
      ['e2e_hw_on', 'state', 'B0', 'Switch', undefined, 'On', 0],
    ])('%s %s = %s is told to HomeKit as %s (%s) %s = %d', async (device, reading, value, service, name, type, expected) => {
      const target = world.named(device, service, type, name);

      await world.notifies(target, expected, () => world.fhem.change(device, reading, value));
      await world.becomes(target, expected);
    });

    it('is left alone while it only says that a command is on its way', async () => {
      const on = world.named('e2e_hw_on', 'Switch', 'On');

      await world.fhem.change('e2e_hw_on', 'state', 'set_on');
      await world.notifies(on, 1, () => world.fhem.change('e2e_hw_on', 'state', 'on'));

      // the only change since the device was last off
      const told = world.homebridge.notifications().filter((notification) => notification.aid === on.aid && notification.iid === on.iid);
      expect(told.slice(-2).map((notification) => Number(notification.value))).toEqual([0, 1]);
    });

    // the mapping names a value the target state does not have.
    it('leaves the security system of the residents armed in its target state when they come home', async () => {
      const current = world.named('residents', 'SecuritySystem', 'SecuritySystemCurrentState');

      await world.notifies(current, 3, () => world.fhem.change('residents', 'state', 'home'));

      expect(logged(/residents-state not a number: home/)).toHaveLength(1);
      expect(await world.homebridge.read(world.named('residents', 'SecuritySystem', 'SecuritySystemTargetState'))).toBe(0);
    });
  });

  describe('a light that reports its colour as xy or as colour temperature', () => {
    // the plugin keeps what it worked out to itself. it shows in the next rgb colour it sends:
    // the brightness HomeKit sets is combined with the hue and saturation the light has.
    it('has hue and saturation worked out for an xy colour', async () => {
      await world.fhem.change('e2e_hw_xy', 'xy', '0.3,0.3');
      await eventually('the plugin to take the xy colour', () => (logged(/caching: e2e_hw_xy-xy: 0\.3,0\.3/).length ? true : undefined), world.homebridge);

      await world.homebridge.write(world.named('e2e_hw_xy', 'Lightbulb', 'Brightness'), 50);

      // the red the light started with would give 800000
      await world.fhem.wasTold('set e2e_hw_xy rgb 5c6280');
    });

    it('has them worked out for a colour temperature from 5600 kelvin on', async () => {
      const ct = world.characteristic('hue_color_xy', hapType.Lightbulb, eveType.CT);

      await world.notifies(ct, 6500, () => world.fhem.change('hue_color_xy', 'ct', '6500'));

      expect(logged(/error in longpoll connection/)).toEqual([]);
    });

    it('fails for a lower colour temperature, and holds back the events that came with it until the next one', async () => {
      const on = world.named('presence', 'OccupancySensor', 'OccupancyDetected');
      const event = (informId: string, value: string) => `${JSON.stringify([informId, value, value])}\n`;

      world.fhem.fake.send(event('hue_color_xy-ct', '366') + event('presence-state', 'present'));
      await eventually('the plugin to report the failure', () => (logged(/error in longpoll connection: /).length ? true : undefined), world.homebridge);
      expect(await world.homebridge.read(on)).toBe(0);

      await world.notifies(on, 1, () => world.fhem.change('roommate', 'presence', 'present'));
    });
  });
});
