// HomeMatic IP devices behind a CCU, as the HMCCU module of fhem lists them: one of every kind the
// HMCCU detection knows, and real ones captured from an installation. the stand-in serves them as fhem
// would list them, so these tests do not run against a real fhem.
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { fixtureDevice as fixture, hmccuDevice } from '../support/devices.ts';
import type { FhemDevice } from '../support/types.ts';
import { realFhemUrl, type StandIn } from './fhem.ts';
import type { TypeName } from './homebridge.ts';
import { startStandInWorld, type World } from './world.ts';

// several of the written fixtures share their hardware address, which is the serial number, so each
// gets its own. the captured ones keep theirs, which differ already.
const hmccuDevices: FhemDevice[] = [
  'hmip-ps-switch',
  'hmip-ps-switch-datapoint-only',
  'hmip-address-reading-format',
  'captured/hmip-fsm-1',
  'hmip-psm-power',
  'hmip-bsm-device',
  'captured/hmip-rgbw-7',
  'hmip-dimmer-datapoint-only',
  'hmip-broll-shutter',
  'hmip-broll-datapoint-only',
  'hmip-broll-scaled',
  'hmip-bbl-venetian',
  'hmip-etrv-thermostat',
  'hmip-etrv-datapoint-only',
  'hmip-wth-wall-thermostat',
  'captured/hmip-swdo-1',
  'hmip-srh-handle',
  'hmip-smi-motion',
  'hmip-spi-presence',
  'hmip-swsd-smoke',
  'hmip-swd-leak',
].map((name, index) =>
  fixture(`hmccu/${name}`, (device) => {
    if (!name.startsWith('captured/')) {
      device.Internals.DEF = `CCU 000E2E${String(index).padStart(8, '0')}:1`;
    }
  }),
);

const devices: FhemDevice[] = [
  ...hmccuDevices,
  // a reading without a channel, set by a datapoint without one
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
];

describe.skipIf(realFhemUrl !== undefined)('devices behind a CCU', () => {
  let world: World & { fhem: StandIn };

  beforeAll(async () => {
    world = await startStandInWorld(devices);
  });

  afterAll(async () => {
    await world.close();
  });

  describe('what homebridge publishes', () => {
    it.each<[string, TypeName, string | undefined, TypeName, number]>([
      // the readings are named after the datapoints of the ccu, with or without their channel
      ['hmip_ps_switch', 'Switch', undefined, 'On', 0],
      ['hmip_ps_switch', 'Switch', undefined, 'StatusLowBattery', 0],
      ['hmip_ps_switch_datapoint_only', 'Switch', undefined, 'On', 1],
      ['hmip_address_reading_format', 'Switch', undefined, 'On', 0],
      // a real HmIP-FSM that genericDeviceType makes a light
      ['hmip_fsm_1', 'Lightbulb', undefined, 'On', 1],
      ['hmip_psm_power', 'Switch', undefined, 'On', 1],
      ['hmip_psm_power', 'Switch', undefined, 'Power', 42.5],
      // the ccu reports milliampere and watt hours
      ['hmip_psm_power', 'Switch', undefined, 'Current', 0.19],
      ['hmip_psm_power', 'Switch', undefined, 'Voltage', 231.2],
      ['hmip_psm_power', 'Switch', undefined, 'Energy', 1.234],
      // a HMCCUDEV with the same datapoint on several channels: the controldatapoint attribute picks channel 4
      ['hmip_bsm_device', 'Switch', undefined, 'On', 1],
      ['hmip_bsm_device', 'Switch', undefined, 'Power', 12],
      // a real HmIP-RGBW that is off: HMCCU says off in LEVEL, and 0 in the pct reading it is read from
      ['hmip_rgbw_7', 'Lightbulb', undefined, 'On', 0],
      ['hmip_rgbw_7', 'Lightbulb', undefined, 'Brightness', 0],
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
      // a real HmIP-SWDO that is closed, with its battery ok
      ['hmip_swdo_1', 'ContactSensor', undefined, 'ContactSensorState', 0],
      ['hmip_swdo_1', 'ContactSensor', undefined, 'CurrentDoorState', 1],
      ['hmip_swdo_1', 'ContactSensor', undefined, 'StatusLowBattery', 0],
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

    it('names the type of a HMCCU device as its model and its address at the ccu as its serial number', () => {
      expect(world.named('hmip_psm_power', 'AccessoryInformation', 'Model').value).toBe('FHEM:HmIP-PSM');
      expect(world.named('hmip_psm_power', 'AccessoryInformation', 'SerialNumber').value).toBe('CCU 000E2E00000004:1');
    });

    it('gives a HMCCU thermostat the range of a HomeMatic IP thermostat for its target temperature', () => {
      expect(world.named('hmip_etrv_thermostat', 'Thermostat', 'TargetTemperature')).toMatchObject({ minValue: 4.5, maxValue: 30.5, minStep: 0.5 });
    });

    it('offers only heating for a HMCCU thermostat that has no commands for its mode', () => {
      expect(world.named('hmip_etrv_datapoint_only', 'Thermostat', 'TargetHeatingCoolingState')).toMatchObject({ value: 1, 'valid-values': [1] });
    });
  });

  describe('a value HomeKit writes', () => {
    it.each<[string, TypeName, string | undefined, TypeName, number | boolean, string]>([
      // with the commands of the device where it has them, and else by setting the datapoint
      ['hmip_ps_switch', 'Switch', undefined, 'On', true, 'on'],
      ['hmip_ps_switch_datapoint_only', 'Switch', undefined, 'On', false, 'datapoint 3.STATE false'],
      ['hmip_address_reading_format', 'Switch', undefined, 'On', true, 'on'],
      // the stand-in does not report back what a set changes, and the device is on already
      ['hmip_fsm_1', 'Lightbulb', undefined, 'On', true, 'on'],
      ['hmip_bsm_device', 'Switch', undefined, 'On', false, 'off'],
      ['hmip_rgbw_7', 'Lightbulb', undefined, 'Brightness', 30, 'pct 30'],
      ['hmip_rgbw_7', 'Lightbulb', undefined, 'On', false, 'off'],
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
  });

  describe('a reading that changes in fhem', () => {
    it.each<[string, string, string, TypeName, string | undefined, TypeName, number]>([
      // the ccu reports a state as true and false or as 1 and 0, depending on how fhem is set up
      ['hmip_ps_switch', '3.STATE', '0', 'Switch', undefined, 'On', 0],
      ['hmip_ps_switch', '3.STATE', 'true', 'Switch', undefined, 'On', 1],
      ['hmip_ps_switch', '0.LOW_BAT', '1', 'Switch', undefined, 'StatusLowBattery', 1],
      ['hmip_ps_switch_datapoint_only', '3.STATE', '1', 'Switch', undefined, 'On', 1],
      ['hmip_ps_switch_datapoint_only', '3.STATE', '0', 'Switch', undefined, 'On', 0],
      // a reading that is named with the address of the device at the ccu
      ['hmip_address_reading_format', '000E1A2B3C4D5E:3.STATE', '0', 'Switch', undefined, 'On', 0],
      ['hmip_address_reading_format', '000E1A2B3C4D5E:3.STATE', 'true', 'Switch', undefined, 'On', 1],
      // the real HmIP-FSM reports on and off in its state reading
      ['hmip_fsm_1', 'state', 'off', 'Lightbulb', undefined, 'On', 0],
      ['hmip_fsm_1', 'state', 'on', 'Lightbulb', undefined, 'On', 1],
      ['hmip_psm_power', 'POWER', '100.5', 'Switch', undefined, 'Power', 100.5],
      ['hmip_psm_power', 'CURRENT', '500', 'Switch', undefined, 'Current', 0.5],
      ['hmip_psm_power', 'VOLTAGE', '229.8', 'Switch', undefined, 'Voltage', 229.8],
      ['hmip_psm_power', 'ENERGY_COUNTER', '2000', 'Switch', undefined, 'Energy', 2],
      ['hmip_bsm_device', '4.STATE', '1', 'Switch', undefined, 'On', 1],
      ['hmip_bsm_device', '4.STATE', 'false', 'Switch', undefined, 'On', 0],
      ['hmip_bsm_device', '6.POWER', '7.5', 'Switch', undefined, 'Power', 7.5],
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
      // the real HmIP-RGBW is read from pct, which is the level in percent
      ['hmip_rgbw_7', 'pct', '60', 'Lightbulb', undefined, 'Brightness', 60],
      ['hmip_rgbw_7', 'pct', '0', 'Lightbulb', undefined, 'On', 0],
      // the real HmIP-SWDO reports open and closed in its state reading
      ['hmip_swdo_1', 'state', 'open', 'ContactSensor', undefined, 'ContactSensorState', 1],
      ['hmip_swdo_1', 'state', 'closed', 'ContactSensor', undefined, 'ContactSensorState', 0],
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
      const brightness = world.named('hmip_dimmer_datapoint_only', 'Lightbulb', 'Brightness');
      const tilt = world.named('hmip_bbl_venetian', 'WindowCovering', 'CurrentHorizontalTiltAngle');
      const before = world.homebridge.notifications().length;

      await world.fhem.change('hmip_dimmer_datapoint_only', '4.LEVEL', 'unknown');
      await world.fhem.change('hmip_bbl_venetian', '4.LEVEL_2', 'unknown');
      // the events after them have arrived, so they have as well
      await world.notifies(brightness, 40, () => world.fhem.change('hmip_dimmer_datapoint_only', '4.LEVEL', '0.4'));
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
  });
});
