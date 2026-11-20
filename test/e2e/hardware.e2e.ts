// device types that only exist with their hardware or with another module of fhem, and what
// the eventMap attribute does. the stand-in serves them as fhem would list them, so these
// tests do not run against a real fhem.
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { fixtureDevices, hmccuDevice } from '../support/devices.ts';
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

// HomeMatic IP devices behind a CCU, one of every kind the HMCCU detection knows. several of
// the fixtures share their hardware address, which is the serial number, so each gets its own.
const hmccuDevices: FhemDevice[] = [
  'hmip-ps-switch',
  'hmip-ps-switch-datapoint-only',
  'hmip-address-reading-format',
  'hmip-outlet-generic-type',
  'hmip-psm-power',
  'hmip-bsm-device',
  'hmip-bdt-dimmer',
  'hmip-dimmer-datapoint-only',
  'hmip-broll-shutter',
  'hmip-broll-datapoint-only',
  'hmip-broll-scaled',
  'hmip-bbl-venetian',
  'hmip-etrv-thermostat',
  'hmip-etrv-datapoint-only',
  'hmip-wth-wall-thermostat',
  'hmip-swdo-contact',
  'hmip-srh-handle',
  'hmip-smi-motion',
  'hmip-spi-presence',
  'hmip-swsd-smoke',
  'hmip-swd-leak',
].map((name, index) =>
  fixture(`hmccu/${name}`, (device) => {
    device.Internals.DEF = `CCU 000E2E${String(index).padStart(8, '0')}:1`;
  }),
);

// characteristics HomeKit does not define, which follow the hue and the saturation the plugin works out
const workedOutHue = 'E863F1C1-079E-48FF-8F27-9C2605A29F52';
const workedOutSaturation = 'E863F1C2-079E-48FF-8F27-9C2605A29F52';

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
  // without a genericDeviceType: the plugin knows the shutters of these two modules by itself
  fixture('blind/somfy', (device) => {
    delete device.Attributes.genericDeviceType;
  }),
  fixture('blind/duofern', (device) => {
    delete device.Attributes.genericDeviceType;
  }),
  fixture('color/hue-color-ct'),
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
  // with the serial number as an attribute, which HomeMatic devices have once they are paired
  fixture('dimmer/cul_hm-dimmer', (device) => {
    device.Attributes.serialNr = 'MEQ0123456';
  }),
  ...hmccuDevices,
  // HMCCU: a reading without a channel, set by a datapoint without one
  hmccuDevice({
    Internals: { NAME: 'e2e_hw_ccu_bare', FUUID: 'e2e-hw-ccu-bare', DEF: 'CCU 000E2E00000101:3' },
    Attributes: { genericDeviceType: 'switch' },
    Readings: { STATE: 'false' },
    PossibleSets: 'datapoint',
  }),
  // the same, with the channel named by an attribute
  hmccuDevice({
    Internals: { NAME: 'e2e_hw_ccu_pinned', FUUID: 'e2e-hw-ccu-pinned', DEF: 'CCU 000E2E00000102:3' },
    Attributes: { genericDeviceType: 'switch', statedatapoint: '3.STATE' },
    Readings: { STATE: 'true' },
    PossibleSets: 'datapoint',
  }),
  // a ccuscaleval attribute that scales something else than the level
  hmccuDevice({
    Internals: { NAME: 'e2e_hw_ccu_dimmer', FUUID: 'e2e-hw-ccu-dimmer', DEF: 'CCU 000E2E00000103:4', ccutype: 'HmIP-BDT' },
    Attributes: { ccuscaleval: 'ACTUAL_TEMPERATURE:0:100:0:1' },
    Readings: { '4.LEVEL': '0.6' },
    PossibleSets: 'pct on off',
  }),

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
  // one that is in colour temperature mode when homebridge starts. the ct mapping has the plugin look at the reading.
  asJsonlist2({
    name: 'e2e_hw_ct',
    setList: 'on off rgb:colorpicker,RGB',
    readingList: 'rgb',
    readings: { state: 'on', rgb: 'FF0000', colormode: 'ct', ct: '500' },
    attributes: { homebridgeMapping: 'ct=reading=ct' },
  }),
  // one whose worked out hue and saturation are shown, in degrees and percent
  asJsonlist2({
    name: 'e2e_hw_worked_out',
    setList: 'on off rgb:colorpicker,RGB',
    readingList: 'rgb',
    readings: { state: 'on', rgb: 'FF0000', colormode: 'ct', ct: '366' },
    attributes: {
      homebridgeMapping:
        'CT=ct,name=CT,format=UINT16 ' +
        `${workedOutHue}=h,name=WorkedOutHue,format=FLOAT,factor=360,minStep=1 ` +
        `${workedOutSaturation}=s,name=WorkedOutSaturation,format=FLOAT,factor=100,minStep=1`,
    },
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
      // the colour temperature in mired, as the lamp reports it
      ['hue_color_ct', 'Lightbulb', undefined, 'ColorTemperature', 366],
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
      // HMCCU: the readings are named after the datapoints of the ccu, with or without their channel
      ['hmip_ps_switch', 'Switch', undefined, 'On', 0],
      ['hmip_ps_switch', 'Switch', undefined, 'StatusLowBattery', 0],
      ['hmip_ps_switch_datapoint_only', 'Switch', undefined, 'On', 1],
      ['hmip_address_reading_format', 'Switch', undefined, 'On', 0],
      ['hmip_outlet_generic_type', 'Outlet', undefined, 'On', 1],
      ['hmip_psm_power', 'Switch', undefined, 'On', 1],
      ['hmip_psm_power', 'Switch', undefined, 'Power', 42.5],
      // the ccu reports milliampere and watt hours
      ['hmip_psm_power', 'Switch', undefined, 'Current', 0.19],
      ['hmip_psm_power', 'Switch', undefined, 'Voltage', 231.2],
      ['hmip_psm_power', 'Switch', undefined, 'Energy', 1.234],
      // a HMCCUDEV with the same datapoint on several channels: the controldatapoint attribute picks channel 4
      ['hmip_bsm_device', 'Switch', undefined, 'On', 1],
      ['hmip_bsm_device', 'Switch', undefined, 'Power', 12],
      // LEVEL runs from 0 to 1
      ['hmip_bdt_dimmer', 'Lightbulb', undefined, 'On', 1],
      ['hmip_bdt_dimmer', 'Lightbulb', undefined, 'Brightness', 60],
      ['hmip_dimmer_datapoint_only', 'Lightbulb', undefined, 'On', 0],
      ['hmip_dimmer_datapoint_only', 'Lightbulb', undefined, 'Brightness', 0],
      ['hmip_broll_shutter', 'WindowCovering', undefined, 'CurrentPosition', 35],
      ['hmip_broll_shutter', 'WindowCovering', undefined, 'TargetPosition', 35],
      ['hmip_broll_shutter', 'WindowCovering', undefined, 'PositionState', 2],
      ['hmip_broll_datapoint_only', 'WindowCovering', undefined, 'CurrentPosition', 50],
      // the ccuscaleval attribute of this one has fhem report percent already
      ['hmip_broll_scaled', 'WindowCovering', undefined, 'CurrentPosition', 35],
      ['hmip_broll_scaled', 'WindowCovering', undefined, 'PositionState', 1],
      ['hmip_bbl_venetian', 'WindowCovering', undefined, 'CurrentPosition', 100],
      ['hmip_bbl_venetian', 'WindowCovering', undefined, 'PositionState', 0],
      // slats that are half open are level
      ['hmip_bbl_venetian', 'WindowCovering', undefined, 'CurrentHorizontalTiltAngle', 0],
      ['hmip_bbl_venetian', 'WindowCovering', undefined, 'TargetHorizontalTiltAngle', 0],
      ['hmip_etrv_thermostat', 'Thermostat', undefined, 'TargetTemperature', 21],
      ['hmip_etrv_thermostat', 'Thermostat', undefined, 'CurrentTemperature', 19.4],
      // the valve is open by a quarter, so it heats
      ['hmip_etrv_thermostat', 'Thermostat', undefined, 'Actuation', 25],
      ['hmip_etrv_thermostat', 'Thermostat', undefined, 'CurrentHeatingCoolingState', 1],
      ['hmip_etrv_thermostat', 'Thermostat', undefined, 'TargetHeatingCoolingState', 3],
      ['hmip_etrv_thermostat', 'Thermostat', undefined, 'StatusLowBattery', 0],
      ['hmip_etrv_datapoint_only', 'Thermostat', undefined, 'TargetTemperature', 18],
      ['hmip_etrv_datapoint_only', 'Thermostat', undefined, 'CurrentTemperature', 17],
      ['hmip_wth_wall_thermostat', 'Thermostat', undefined, 'TargetTemperature', 22],
      ['hmip_wth_wall_thermostat', 'Thermostat', undefined, 'CurrentTemperature', 21.1],
      ['hmip_wth_wall_thermostat', 'Thermostat', undefined, 'CurrentRelativeHumidity', 48],
      ['hmip_wth_wall_thermostat', 'Thermostat', undefined, 'TargetHeatingCoolingState', 1],
      ['hmip_swdo_contact', 'ContactSensor', undefined, 'ContactSensorState', 0],
      ['hmip_swdo_contact', 'ContactSensor', undefined, 'CurrentDoorState', 1],
      ['hmip_swdo_contact', 'ContactSensor', undefined, 'StatusLowBattery', 1],
      // a window handle that is turned to open
      ['hmip_srh_handle', 'ContactSensor', undefined, 'ContactSensorState', 1],
      ['hmip_smi_motion', 'MotionSensor', undefined, 'MotionDetected', 1],
      ['hmip_smi_motion', 'LightSensor', undefined, 'CurrentAmbientLightLevel', 23],
      ['hmip_spi_presence', 'OccupancySensor', undefined, 'OccupancyDetected', 1],
      ['hmip_spi_presence', 'LightSensor', undefined, 'CurrentAmbientLightLevel', 110.5],
      ['hmip_swsd_smoke', 'SmokeSensor', undefined, 'SmokeDetected', 1],
      ['hmip_swd_leak', 'LeakSensor', undefined, 'LeakDetected', 0],
      ['hmip_swd_leak', 'LeakSensor', undefined, 'StatusLowBattery', 1],
      ['e2e_hw_ccu_bare', 'Switch', undefined, 'On', 0],
      ['e2e_hw_ccu_pinned', 'Switch', undefined, 'On', 1],
      // LEVEL runs from 0 to 1, as nothing scales it
      ['e2e_hw_ccu_dimmer', 'Lightbulb', undefined, 'Brightness', 60],
    ])('shows %s in %s (%s) %s as %d', (device, service, name, type, value) => {
      expect(Number(world.named(device, service, type, name).value)).toBe(value);
    });

    it('converts luminosity to lux', () => {
      expect(world.named('luminosity', 'LightSensor', 'CurrentAmbientLightLevel').value).toBeCloseTo(200);
    });

    it('gives a shutter with a stop command the characteristic HomeKit stops a blind with', () => {
      expect(world.characteristicsOf('duofern', hapType.WindowCovering)).toContain(hapType.HoldPosition);
      expect(world.characteristicsOf('somfy', hapType.WindowCovering)).toContain(hapType.HoldPosition);
    });

    it('takes the range of the colour temperature of a hue lamp from its set command', () => {
      expect(world.named('hue_color_ct', 'Lightbulb', 'ColorTemperature')).toMatchObject({ minValue: 153, maxValue: 500 });
    });

    it('takes the range of the target temperature of a MAX thermostat from its set command', () => {
      expect(world.named('max_heating', 'Thermostat', 'TargetTemperature')).toMatchObject({ minValue: 5, maxValue: 30, minStep: 0.5 });
    });

    it('names the type of a HMCCU device as its model and its address at the ccu as its serial number', () => {
      expect(world.named('hmip_psm_power', 'AccessoryInformation', 'Model').value).toBe('FHEM:HmIP-PSM');
      expect(world.named('hmip_psm_power', 'AccessoryInformation', 'SerialNumber').value).toBe('CCU 000E2E00000004:1');
    });

    it('takes the serial number of a HomeMatic device from its serialNr attribute', () => {
      expect(world.named('cul_hm_dimmer', 'AccessoryInformation', 'SerialNumber').value).toBe('MEQ0123456');
    });

    it('gives a HMCCU thermostat the range of a HomeMatic IP thermostat for its target temperature', () => {
      expect(world.named('hmip_etrv_thermostat', 'Thermostat', 'TargetTemperature')).toMatchObject({ minValue: 4.5, maxValue: 30.5, minStep: 0.5 });
    });

    it('offers only heating for a HMCCU thermostat that has no commands for its mode', () => {
      expect(world.named('hmip_etrv_datapoint_only', 'Thermostat', 'TargetHeatingCoolingState')).toMatchObject({ value: 1, 'valid-values': [1] });
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
      ['duofern', 'WindowCovering', undefined, 'HoldPosition', true, 'stop'],
      ['hue_color_ct', 'Lightbulb', undefined, 'ColorTemperature', 300, 'ct 300'],
      ['max_heating', 'Thermostat', undefined, 'TargetTemperature', 22, 'desiredTemperature 22'],
      ['pid20', 'Thermostat', undefined, 'TargetTemperature', 22, 'desired 22'],
      ['comet_dect', 'Thermostat', undefined, 'TargetTemperature', 23, 'desired-temp 23'],
      ['e2e_hw_on', 'Switch', undefined, 'On', true, 'an'],
      // HMCCU: with the commands of the device where it has them, and else by setting the datapoint
      ['hmip_ps_switch', 'Switch', undefined, 'On', true, 'on'],
      ['hmip_ps_switch_datapoint_only', 'Switch', undefined, 'On', false, 'datapoint 3.STATE false'],
      ['hmip_address_reading_format', 'Switch', undefined, 'On', true, 'on'],
      ['hmip_outlet_generic_type', 'Outlet', undefined, 'On', false, 'off'],
      ['hmip_bsm_device', 'Switch', undefined, 'On', false, 'off'],
      ['hmip_bdt_dimmer', 'Lightbulb', undefined, 'Brightness', 30, 'pct 30'],
      ['hmip_bdt_dimmer', 'Lightbulb', undefined, 'On', false, 'off'],
      // the datapoint takes the level from 0 to 1
      ['hmip_dimmer_datapoint_only', 'Lightbulb', undefined, 'Brightness', 50, 'datapoint 4.LEVEL 0.5'],
      ['hmip_dimmer_datapoint_only', 'Lightbulb', undefined, 'On', false, 'datapoint 4.LEVEL 0'],
      ['hmip_broll_shutter', 'WindowCovering', undefined, 'TargetPosition', 70, 'pct 70'],
      ['hmip_broll_datapoint_only', 'WindowCovering', undefined, 'TargetPosition', 20, 'datapoint 4.LEVEL 0.2'],
      ['hmip_broll_scaled', 'WindowCovering', undefined, 'TargetPosition', 80, 'pct 80'],
      // the slats all the way open
      ['hmip_bbl_venetian', 'WindowCovering', undefined, 'TargetHorizontalTiltAngle', 90, 'datapoint 4.LEVEL_2 1'],
      ['hmip_etrv_thermostat', 'Thermostat', undefined, 'TargetTemperature', 22, 'desired-temp 22'],
      ['hmip_etrv_thermostat', 'Thermostat', undefined, 'TargetHeatingCoolingState', 1, 'manu'],
      ['hmip_etrv_thermostat', 'Thermostat', undefined, 'TargetHeatingCoolingState', 0, 'off'],
      ['hmip_etrv_datapoint_only', 'Thermostat', undefined, 'TargetTemperature', 19.5, 'datapoint 1.SET_POINT_TEMPERATURE 19.5'],
      ['hmip_wth_wall_thermostat', 'Thermostat', undefined, 'TargetHeatingCoolingState', 3, 'auto'],
      // a reading without a channel is set by the datapoint alone, or with the channel an attribute names
      ['e2e_hw_ccu_bare', 'Switch', undefined, 'On', true, 'datapoint STATE true'],
      ['e2e_hw_ccu_pinned', 'Switch', undefined, 'On', false, 'datapoint 3.STATE false'],
    ])('to %s %s (%s) %s as %s reaches fhem as: set %s', async (device, service, name, type, value, command) => {
      await world.homebridge.write(world.named(device, service, type, name), value);

      await world.fhem.wasTold(`set ${device} ${command}`);
    });

    it('to identify a HUEDevice makes the lamp blink', async () => {
      await world.homebridge.write(world.named('hue_color_xy', 'AccessoryInformation', 'Identify'), true);

      await world.fhem.wasTold('set hue_color_xy alert select');
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
      ['hue_color_ct', 'ct', '250', 'Lightbulb', undefined, 'ColorTemperature', 250],
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
      // HMCCU
      // the ccu reports a state as true and false or as 1 and 0, depending on how fhem is set up
      ['hmip_ps_switch', '3.STATE', '0', 'Switch', undefined, 'On', 0],
      ['hmip_ps_switch', '3.STATE', 'true', 'Switch', undefined, 'On', 1],
      ['hmip_ps_switch', '0.LOW_BAT', '1', 'Switch', undefined, 'StatusLowBattery', 1],
      ['hmip_ps_switch_datapoint_only', '3.STATE', '1', 'Switch', undefined, 'On', 1],
      ['hmip_ps_switch_datapoint_only', '3.STATE', '0', 'Switch', undefined, 'On', 0],
      // a reading that is named with the address of the device at the ccu
      ['hmip_address_reading_format', '000E1A2B3C4D5E:3.STATE', '0', 'Switch', undefined, 'On', 0],
      ['hmip_address_reading_format', '000E1A2B3C4D5E:3.STATE', 'true', 'Switch', undefined, 'On', 1],
      ['hmip_outlet_generic_type', '3.STATE', '1', 'Outlet', undefined, 'On', 1],
      ['hmip_outlet_generic_type', '3.STATE', 'false', 'Outlet', undefined, 'On', 0],
      ['hmip_psm_power', 'POWER', '100.5', 'Switch', undefined, 'Power', 100.5],
      ['hmip_psm_power', 'CURRENT', '500', 'Switch', undefined, 'Current', 0.5],
      ['hmip_psm_power', 'VOLTAGE', '229.8', 'Switch', undefined, 'Voltage', 229.8],
      ['hmip_psm_power', 'ENERGY_COUNTER', '2000', 'Switch', undefined, 'Energy', 2],
      ['hmip_bsm_device', '4.STATE', '1', 'Switch', undefined, 'On', 1],
      ['hmip_bsm_device', '4.STATE', 'false', 'Switch', undefined, 'On', 0],
      ['hmip_bsm_device', '6.POWER', '7.5', 'Switch', undefined, 'Power', 7.5],
      ['hmip_bdt_dimmer', '4.LEVEL', '0.25', 'Lightbulb', undefined, 'Brightness', 25],
      ['hmip_bdt_dimmer', '4.LEVEL', '0.0', 'Lightbulb', undefined, 'Brightness', 0],
      ['hmip_dimmer_datapoint_only', '4.LEVEL', '1.0', 'Lightbulb', undefined, 'Brightness', 100],
      ['hmip_dimmer_datapoint_only', '4.LEVEL', '0.0', 'Lightbulb', undefined, 'On', 0],
      ['hmip_broll_shutter', '4.LEVEL', '0.8', 'WindowCovering', undefined, 'CurrentPosition', 80],
      ['hmip_broll_shutter', '4.ACTIVITY_STATE', '1', 'WindowCovering', undefined, 'PositionState', 1],
      ['hmip_broll_shutter', '4.ACTIVITY_STATE', '2', 'WindowCovering', undefined, 'PositionState', 0],
      ['hmip_broll_datapoint_only', '4.LEVEL', '0.05', 'WindowCovering', undefined, 'CurrentPosition', 5],
      ['hmip_broll_scaled', '4.LEVEL', '60', 'WindowCovering', undefined, 'CurrentPosition', 60],
      ['hmip_bbl_venetian', '4.LEVEL', '0.1', 'WindowCovering', undefined, 'CurrentPosition', 10],
      ['hmip_bbl_venetian', '4.LEVEL_2', '1.0', 'WindowCovering', undefined, 'CurrentHorizontalTiltAngle', 90],
      ['hmip_bbl_venetian', '4.LEVEL_2', '0.0', 'WindowCovering', undefined, 'CurrentHorizontalTiltAngle', -90],
      ['hmip_bbl_venetian', '4.DIRECTION', '1', 'WindowCovering', undefined, 'PositionState', 1],
      ['hmip_etrv_thermostat', '1.SET_POINT_TEMPERATURE', '17.5', 'Thermostat', undefined, 'TargetTemperature', 17.5],
      ['hmip_etrv_thermostat', '1.ACTUAL_TEMPERATURE', '20.2', 'Thermostat', undefined, 'CurrentTemperature', 20.2],
      ['hmip_etrv_thermostat', '1.LEVEL', '0.4', 'Thermostat', undefined, 'Actuation', 40],
      // with its valve closed it does not heat
      ['hmip_etrv_thermostat', '1.LEVEL', '0.0', 'Thermostat', undefined, 'CurrentHeatingCoolingState', 0],
      ['hmip_etrv_thermostat', '1.LEVEL', '0.6', 'Thermostat', undefined, 'CurrentHeatingCoolingState', 1],
      ['hmip_etrv_thermostat', '1.SET_POINT_MODE', '1', 'Thermostat', undefined, 'TargetHeatingCoolingState', 1],
      ['hmip_etrv_thermostat', '1.SET_POINT_MODE', '0', 'Thermostat', undefined, 'TargetHeatingCoolingState', 3],
      ['hmip_etrv_thermostat', '0.LOW_BAT', '1', 'Thermostat', undefined, 'StatusLowBattery', 1],
      ['hmip_etrv_datapoint_only', '1.SET_POINT_TEMPERATURE', '21.0', 'Thermostat', undefined, 'TargetTemperature', 21],
      ['hmip_wth_wall_thermostat', '1.HUMIDITY', '55', 'Thermostat', undefined, 'CurrentRelativeHumidity', 55],
      ['hmip_wth_wall_thermostat', '1.CONTROL_MODE', 'MANU-MODE', 'Thermostat', undefined, 'TargetHeatingCoolingState', 1],
      ['hmip_wth_wall_thermostat', '1.CONTROL_MODE', 'AUTO-MODE', 'Thermostat', undefined, 'TargetHeatingCoolingState', 3],
      ['hmip_swdo_contact', '1.STATE', '1', 'ContactSensor', undefined, 'ContactSensorState', 1],
      ['hmip_swdo_contact', '1.STATE', '0', 'ContactSensor', undefined, 'CurrentDoorState', 1],
      ['hmip_swdo_contact', '0.LOW_BAT', '0', 'ContactSensor', undefined, 'StatusLowBattery', 0],
      // the handle is closed, then tilted
      ['hmip_srh_handle', '1.STATE', '0', 'ContactSensor', undefined, 'ContactSensorState', 0],
      ['hmip_srh_handle', '1.STATE', '1', 'ContactSensor', undefined, 'ContactSensorState', 1],
      ['hmip_smi_motion', '1.MOTION', '0', 'MotionSensor', undefined, 'MotionDetected', 0],
      ['hmip_smi_motion', '1.ILLUMINATION', '80.5', 'LightSensor', undefined, 'CurrentAmbientLightLevel', 80.5],
      ['hmip_spi_presence', '1.PRESENCE_DETECTION_STATE', '0', 'OccupancySensor', undefined, 'OccupancyDetected', 0],
      ['hmip_spi_presence', '1.CURRENT_ILLUMINATION', '15', 'LightSensor', undefined, 'CurrentAmbientLightLevel', 15],
      ['hmip_swsd_smoke', '1.SMOKE_DETECTOR_ALARM_STATUS', '0', 'SmokeSensor', undefined, 'SmokeDetected', 0],
      // 3 is the alarm of another detector of the group
      ['hmip_swsd_smoke', '1.SMOKE_DETECTOR_ALARM_STATUS', '3', 'SmokeSensor', undefined, 'SmokeDetected', 1],
      ['hmip_swd_leak', '1.WATERLEVEL_DETECTED', '1', 'LeakSensor', undefined, 'LeakDetected', 1],
      ['hmip_swd_leak', '0.LOWBAT', 'false', 'LeakSensor', undefined, 'StatusLowBattery', 0],
    ])('%s %s = %s is told to HomeKit as %s (%s) %s = %d', async (device, reading, value, service, name, type, expected) => {
      const target = world.named(device, service, type, name);

      await world.notifies(target, expected, () => world.fhem.change(device, reading, value));
      await world.becomes(target, expected);
    });

    it('of a HMCCU level that is no number changes nothing', async () => {
      const brightness = world.named('hmip_bdt_dimmer', 'Lightbulb', 'Brightness');
      const tilt = world.named('hmip_bbl_venetian', 'WindowCovering', 'CurrentHorizontalTiltAngle');
      const before = world.homebridge.notifications().length;

      await world.fhem.change('hmip_bdt_dimmer', '4.LEVEL', 'unknown');
      await world.fhem.change('hmip_bbl_venetian', '4.LEVEL_2', 'unknown');
      // the events after them have arrived, so they have as well
      await world.notifies(brightness, 40, () => world.fhem.change('hmip_bdt_dimmer', '4.LEVEL', '0.4'));
      await world.notifies(tilt, 0, () => world.fhem.change('hmip_bbl_venetian', '4.LEVEL_2', '0.5'));

      const told = (target: { aid: number; iid: number }) =>
        world.homebridge
          .notifications()
          .slice(before)
          .filter((notification) => notification.aid === target.aid && notification.iid === target.iid)
          .map((notification) => Number(notification.value));
      expect(told(brightness)).toEqual([40]);
      expect(told(tilt)).toEqual([0]);
    });

    it('is left alone while it only says that a command is on its way', async () => {
      const on = world.named('e2e_hw_on', 'Switch', 'On');

      await world.fhem.change('e2e_hw_on', 'state', 'set_on');
      await world.notifies(on, 1, () => world.fhem.change('e2e_hw_on', 'state', 'on'));

      // the only change since the device was last off
      const told = world.homebridge.notifications().filter((notification) => notification.aid === on.aid && notification.iid === on.iid);
      expect(told.slice(-2).map((notification) => Number(notification.value))).toEqual([0, 1]);
    });

    it('disarms the security system of the residents in both of its states when they come home', async () => {
      const target = world.named('residents', 'SecuritySystem', 'SecuritySystemTargetState');

      await world.notifies(target, 3, () => world.fhem.change('residents', 'state', 'home'));

      await world.becomes(world.named('residents', 'SecuritySystem', 'SecuritySystemCurrentState'), 3);
      expect(logged(/residents-state not a number/)).toEqual([]);
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

    it('has them worked out for the colour temperature it has when homebridge starts', async () => {
      await world.homebridge.write(world.named('e2e_hw_ct', 'Lightbulb', 'Brightness'), 50);

      // the warm white of 500 mired at half its brightness. the red of its rgb reading would give 800000.
      await world.fhem.wasTold('set e2e_hw_ct rgb 805937');
    });

    // what the plugin works out is shown by two characteristics that follow it
    it.each([
      // 2000 kelvin, a warm white
      ['500', 28, 57],
      // no colour temperature is taken for white
      ['abc', 0, 0],
      ['-1000', 0, 100],
      // just below and just above 5600 kelvin, where the white turns from yellowish to bluish
      ['179', 60, 1],
      ['178', 300, 2],
      // 10000 kelvin, a cold white
      ['100', 222, 23],
      ['-100', 0, 100],
    ])('has a colour temperature of %s worked out as a hue of %d degrees with a saturation of %d percent', async (ct, hue, saturation) => {
      await world.fhem.change('e2e_hw_worked_out', 'ct', ct);

      await world.becomes(world.characteristic('e2e_hw_worked_out', hapType.Lightbulb, workedOutHue), hue);
      await world.becomes(world.characteristic('e2e_hw_worked_out', hapType.Lightbulb, workedOutSaturation), saturation);
    });

    it('has them worked out for a colour temperature from 5600 kelvin on', async () => {
      const ct = world.characteristic('hue_color_xy', hapType.Lightbulb, eveType.CT);

      await world.notifies(ct, 6500, () => world.fhem.change('hue_color_xy', 'ct', '6500'));

      expect(logged(/error in longpoll connection/)).toEqual([]);
    });

    it('has them worked out for a lower colour temperature as well, and hands on the events that came with it', async () => {
      const present = world.named('presence', 'OccupancySensor', 'OccupancyDetected');
      const event = (informId: string, value: string) => `${JSON.stringify([informId, value, value])}\n`;

      await world.notifies(present, 1, () => {
        world.fhem.fake.send(event('hue_color_xy-ct', '366') + event('presence-state', 'present'));
        return Promise.resolve();
      });

      expect(logged(/error in longpoll connection/)).toEqual([]);
    });
  });
});
