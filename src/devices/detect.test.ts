import * as hap from '@homebridge/hap-nodejs';
import { describe, expect, it } from 'vitest';
import { createLog } from '../../test/support/log.ts';
import { PluginState } from '../state/pluginState.ts';
import { detectMappings, reviseMappings, type DetectionTarget } from './detect.ts';
import type { Jsonlist2Device } from './types.ts';

function detect(device: Partial<Jsonlist2Device> & { TYPE?: string }) {
  const log = createLog();
  const target = { log: log as unknown as DetectionTarget['log'] } as DetectionTarget;
  const s: Jsonlist2Device = {
    Internals: { NAME: 'dev', TYPE: device.TYPE ?? 'dummy' },
    Readings: {},
    Attributes: {},
    PossibleSets: '',
    PossibleAttrs: '',
    ...device,
  };
  const detected = detectMappings(target, s, new PluginState(hap));
  return { detected, target, s, log: log.lines };
}

describe('detectMappings', () => {
  it('lets the first rule that recognises the device name the service', () => {
    // a dimmer that also measures temperature is a light, not a thermometer
    const { target } = detect({ PossibleSets: 'on off pct', Readings: { pct: { Value: '10' }, temperature: { Value: '20' } } });

    expect(target.service_name).toBe('light');
    expect(Object.keys(target.mappings)).toEqual(['On', 'Brightness', 'CurrentTemperature']);
  });

  it('keeps the genericDeviceType over what the rules recognise', () => {
    const { target } = detect({ PossibleSets: 'on off pct', Attributes: { genericDeviceType: 'outlet' } });

    expect(target.service_name).toBe('outlet');
  });

  it('uses the genericDisplayType when there is no genericDeviceType', () => {
    expect(detect({ PossibleSets: 'on off', Attributes: { genericDisplayType: 'light' } }).target.service_name).toBe('light');
  });

  it('skips a device that is to be ignored before it has mappings', () => {
    const { detected, target, log } = detect({ PossibleSets: 'on off', Attributes: { genericDeviceType: 'ignore' } });

    expect(detected).toBe('ignored');
    expect(target.mappings).toBeUndefined();
    expect(log).toEqual(['info ignoring dev']);
  });

  it('skips a device whose genericDeviceType is empty, which names no service', () => {
    const { detected } = detect({ Attributes: { genericDeviceType: '' } });

    expect(detected).toBe('undetected');
  });

  it('takes the genericDisplayType when the genericDeviceType is empty, and ignores a structure then', () => {
    expect(detect({ Attributes: { genericDeviceType: '', genericDisplayType: 'switch' } }).target.service_name).toBe('switch');
    expect(detect({ TYPE: 'structure', Attributes: { genericDeviceType: '' } }).detected).toBe('ignored');
  });

  it('skips a device nothing is recognised of', () => {
    const { detected, target, log } = detect({});

    expect(detected).toBe('undetected');
    expect(target.mappings).toEqual({});
    expect(log).toEqual(['error dev: no service type detected']);
  });

  it('skips the device behind a harmony hub without a word', () => {
    const { detected, log } = detect({ TYPE: 'harmony', Internals: { NAME: 'dev', TYPE: 'harmony', id: '1' }, PossibleSets: 'on off' });

    expect(detected).toBe('ignored');
    expect(log).toEqual([]);
  });

  it('leaves a HMCCU device the HMCCU rule does not know to the other rules', () => {
    const { target } = detect({
      Internals: { NAME: 'dev', TYPE: 'HMCCUCHN', ccutype: 'X' },
      Readings: { '1.ACTUAL_TEMPERATURE': { Value: '20' }, temperature: { Value: '20' } },
    });

    expect(target.service_name).toBe('thermometer');
  });

  it('takes a blind that is set with pct for a blind, unless its type says otherwise', () => {
    const blind = { PossibleSets: 'on off pct', Readings: { pct: { Value: '40' } }, Attributes: { subType: 'blindActuator' } };

    expect(detect(blind).target.service_name).toBe('blind');
    expect(detect({ ...blind, Attributes: { ...blind.Attributes, genericDeviceType: 'light' } }).target.service_name).toBe('light');
  });
});

describe('a window', () => {
  const skylight = { PossibleSets: 'pct:slider,0,1,100', Readings: { pct: { Value: '10' } }, Attributes: { genericDeviceType: 'window' } };

  it('that is set with pct gets its position from pct and no brightness', () => {
    const { target, s } = detect(skylight);
    reviseMappings(target, s);

    expect(target.service_name).toBe('window');
    expect(target.mappings).toEqual({ CurrentPosition: { reading: 'pct' }, TargetPosition: { reading: 'pct', cmd: 'pct', delay: true } });
  });

  it('has no brightness with any command a dimmer is set with', () => {
    for (const PossibleSets of ['on off dim:slider,0,1,99', 'on off dim06% dim100%', 'on off bri:slider,0,1,254']) {
      expect(detect({ ...skylight, PossibleSets }).target.mappings, PossibleSets).not.toHaveProperty('Brightness');
    }
  });

  it('leaves the brightness of what is no window alone', () => {
    expect(detect({ ...skylight, Attributes: {} }).target.mappings).toHaveProperty('Brightness');
  });
});

describe('an FS20 dimmer', () => {
  const step = (percent: number) => {
    const { target } = detect({ PossibleSets: 'on off dim06% dim50% dim100%', Readings: { state: { Value: 'dim50%' } } });
    return (target.mappings.Brightness as { homekit2reading: (value: number) => unknown }).homekit2reading(percent);
  };

  it.each([
    [0, 'off'],
    [1, 'dim06%'],
    [6, 'dim06%'],
    [9, 'dim06%'],
    [10, 'dim12%'],
    [25, 'dim25%'],
    [50, 'dim50%'],
    [53, 'dim50%'],
    [54, 'dim56%'],
    [75, 'dim75%'],
    [96, 'dim93%'],
    [97, 'dim100%'],
    [100, 'dim100%'],
  ])('sends a brightness of %i as %s, the nearest of its sixteen steps', (percent, command) => {
    expect(step(percent)).toBe(command);
  });

  it('reads back the step it sent', () => {
    const { target } = detect({ PossibleSets: 'on off dim06% dim50% dim100%', Readings: { state: { Value: 'dim50%' } } });
    const brightness = target.mappings.Brightness as { reading2homekit: (value: string) => number; homekit2reading: (value: number) => string };

    for (const percent of [6, 12, 18, 25, 31, 37, 43, 50, 56, 62, 68, 75, 81, 87, 93, 100]) {
      expect(brightness.reading2homekit(brightness.homekit2reading(percent)), `${percent}`).toBe(percent);
    }
  });
});

describe('reviseMappings', () => {
  it('takes the switch away from what has a position', () => {
    const { target, s } = detect({ PossibleSets: 'on off pct', Attributes: { subType: 'blindActuator' } });
    expect(target.mappings).toHaveProperty('On');

    reviseMappings(target, s);

    expect(Object.keys(target.mappings)).toEqual(['CurrentPosition', 'TargetPosition']);
  });

  it('takes the target temperature away when the device has no command for it', () => {
    const { target, s, log } = detect({ Attributes: { genericDeviceType: 'thermostat' } });
    target.mappings.TargetTemperature = { cmd: 'desired-temp 5' };

    reviseMappings(target, s);

    expect(target.mappings).not.toHaveProperty('TargetTemperature');
    expect(log.at(-1)).toBe('error dev is NOT a thermostat. set command for target temperature missing: desired-temp 5');
  });
});
