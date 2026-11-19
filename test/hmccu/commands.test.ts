// the exact 'set ...' string sent to fhem when homekit changes a value
import { describe, it } from 'vitest';
import { accessoryFor, check, command, device } from '../support/ported.ts';

describe("the exact 'set ...' string sent to fhem when homekit changes a value", () => {
  it('switch with set on/off', () => {
    const a = accessoryFor(
      device({
        Internals: { NAME: 'Plug', ccutype: 'HmIP-PS', ccurole: 'SWITCH_VIRTUAL_RECEIVER' },
        Readings: { '3.STATE': 'false' },
        PossibleSets: 'on:noArg off:noArg datapoint',
      }),
    );
    command(a, 'On', 1, 'set Plug on');
    command(a, 'On', 0, 'set Plug off');
  });

  it('switch without set on/off', () => {
    const a = accessoryFor(
      device({
        Internals: { NAME: 'Plug2', ccutype: 'HmIP-PS', ccurole: 'SWITCH_VIRTUAL_RECEIVER' },
        Readings: { '3.STATE': 'false' },
        PossibleSets: 'datapoint config',
      }),
    );
    command(a, 'On', 1, 'set Plug2 datapoint 3.STATE true');
    command(a, 'On', 0, 'set Plug2 datapoint 3.STATE false');
  });

  it('blind with set pct', () => {
    const a = accessoryFor(
      device({
        Internals: { NAME: 'Roll', ccutype: 'HmIP-BROLL', ccurole: 'SHUTTER_VIRTUAL_RECEIVER' },
        Readings: { '4.LEVEL': '0.35' },
        PossibleSets: 'pct:slider,0,1,100 up down stop datapoint',
      }),
    );
    command(a, 'TargetPosition', 50, 'set Roll pct 50');
    command(a, 'TargetPosition', 0, 'set Roll pct 0');
    command(a, 'TargetPosition', 100, 'set Roll pct 100');
  });

  it('blind without set pct, LEVEL is a 0.0-1.0 datapoint', () => {
    const a = accessoryFor(
      device({
        Internals: { NAME: 'Roll3', ccutype: 'HmIP-BROLL', ccurole: 'SHUTTER_VIRTUAL_RECEIVER' },
        Readings: { '4.LEVEL': '0.5' },
        PossibleSets: 'datapoint config',
      }),
    );
    command(a, 'TargetPosition', 50, 'set Roll3 datapoint 4.LEVEL 0.5');
    command(a, 'TargetPosition', 33, 'set Roll3 datapoint 4.LEVEL 0.33');
    command(a, 'TargetPosition', 100, 'set Roll3 datapoint 4.LEVEL 1');
  });

  it('venetian blind slats', () => {
    const a = accessoryFor(
      device({
        Internals: { NAME: 'Slat', ccutype: 'HmIP-BBL', ccurole: 'BLIND_VIRTUAL_RECEIVER' },
        Readings: { '4.LEVEL': '1.0', '4.LEVEL_2': '0.5' },
        PossibleSets: 'pct:slider,0,1,100 up down stop datapoint',
      }),
    );
    command(a, 'TargetPosition', 60, 'set Slat pct 60');
    command(a, 'TargetHorizontalTiltAngle', -90, 'set Slat datapoint 4.LEVEL_2 0');
    command(a, 'TargetHorizontalTiltAngle', 0, 'set Slat datapoint 4.LEVEL_2 0.5');
    command(a, 'TargetHorizontalTiltAngle', 90, 'set Slat datapoint 4.LEVEL_2 1');
  });

  it('dimmer', () => {
    const a = accessoryFor(
      device({
        Internals: { NAME: 'Dim', ccutype: 'HmIP-BDT', ccurole: 'DIMMER_VIRTUAL_RECEIVER' },
        Readings: { '4.LEVEL': '0.6' },
        PossibleSets: 'on off pct:slider,0,1,100 datapoint',
      }),
    );
    command(a, 'Brightness', 60, 'set Dim pct 60');
    command(a, 'On', 1, 'set Dim on');
    command(a, 'On', 0, 'set Dim off');
  });

  it('thermostat', () => {
    const a = accessoryFor(
      device({
        Internals: { NAME: 'Valve', ccutype: 'HmIP-eTRV-2', ccurole: 'HEATING_CLIMATECONTROL_TRANSCEIVER' },
        Readings: { '1.SET_POINT_TEMPERATURE': '21.0', '1.ACTUAL_TEMPERATURE': '19.4', '1.LEVEL': '0.25', '1.SET_POINT_MODE': '0' },
        PossibleSets: 'desired-temp:slider,4.5,0.5,30.5 auto manu boost on off datapoint',
      }),
    );
    command(a, 'TargetTemperature', 22, 'set Valve desired-temp 22');
    command(a, 'TargetTemperature', 4.5, 'set Valve desired-temp 4.5');
    command(a, 'TargetHeatingCoolingState', 3, 'set Valve auto');
    command(a, 'TargetHeatingCoolingState', 1, 'set Valve manu');
    command(a, 'TargetHeatingCoolingState', 0, 'set Valve off');
  });

  it('thermostat without set desired-temp', () => {
    const a = accessoryFor(
      device({
        Internals: { NAME: 'Valve2', ccutype: 'HmIP-eTRV', ccurole: 'HEATING_CLIMATECONTROL_TRANSCEIVER' },
        Readings: { '1.SET_POINT_TEMPERATURE': '18.0', '1.ACTUAL_TEMPERATURE': '17.0' },
        PossibleSets: 'datapoint config values',
      }),
    );
    command(a, 'TargetTemperature', 22, 'set Valve2 datapoint 1.SET_POINT_TEMPERATURE 22');
  });

  it('CUL_HM devices still produce the same commands', () => {
    const sw = accessoryFor(
      device({
        Internals: { NAME: 'HmSw', TYPE: 'CUL_HM', DEF: 'ABCDEF' },
        Attributes: { model: 'HM-LC-SW1-PL2', subType: 'switch' },
        Readings: { state: 'off' },
        PossibleSets: 'on off toggle',
      }),
    );
    command(sw, 'On', 1, 'set HmSw on');
    command(sw, 'On', 0, 'set HmSw off');

    const th = accessoryFor(
      device({
        Internals: { NAME: 'HmTh', TYPE: 'CUL_HM', DEF: 'ABCDE1' },
        Attributes: { model: 'HM-CC-RT-DN', subType: 'thermostat' },
        Readings: { 'desired-temp': '20.0', 'measured-temp': '19.0' },
        PossibleSets: 'desired-temp:slider,4.5,0.5,30.5 on off',
      }),
    );
    command(th, 'TargetTemperature', 21.5, 'set HmTh desired-temp 21.5');

    const bl = accessoryFor(
      device({
        Internals: { NAME: 'HmBlind', TYPE: 'CUL_HM', DEF: 'ABCDE2' },
        Attributes: { model: 'HM-LC-Bl1-FM', subType: 'blindActuator' },
        Readings: { state: '40', pct: '40' },
        PossibleSets: 'on off pct:slider,0,1,100 up down stop',
      }),
    );
    command(bl, 'TargetPosition', 70, 'set HmBlind pct 70');
  });

  it('readOnly characteristics send nothing', () => {
    const a = accessoryFor(
      device({
        Internals: { NAME: 'RO', ccutype: 'HmIP-PS', ccurole: 'SWITCH_VIRTUAL_RECEIVER' },
        Readings: { '3.STATE': 'false' },
        PossibleSets: 'on off datapoint',
      }),
    );
    a.mappings.On.readOnly = true;
    a.sent.length = 0;
    a.command(a.mappings.On as unknown as string, 1);
    check('no command sent for a readOnly characteristic', a.sent.length === 0, a.sent);
  });
});
