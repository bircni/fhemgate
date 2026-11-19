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

    expect(detected).toBe(false);
    expect(target.mappings).toBeUndefined();
    expect(log).toEqual(['info ignoring dev']);
  });

  it('skips a device nothing is recognised of', () => {
    const { detected, target, log } = detect({});

    expect(detected).toBe(false);
    expect(target.mappings).toEqual({});
    expect(log).toEqual(['error dev: no service type detected']);
  });

  it('skips the device behind a harmony hub without a word', () => {
    const { detected, log } = detect({ TYPE: 'harmony', Internals: { NAME: 'dev', TYPE: 'harmony', id: '1' }, PossibleSets: 'on off' });

    expect(detected).toBe(false);
    expect(log).toEqual([]);
  });

  it('leaves a HMCCU device the HMCCU rule does not know to the other rules', () => {
    const { target } = detect({
      Internals: { NAME: 'dev', TYPE: 'HMCCUCHN', ccutype: 'X' },
      Readings: { '1.ACTUAL_TEMPERATURE': { Value: '20' }, temperature: { Value: '20' } },
    });

    expect(target.service_name).toBe('thermometer');
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
