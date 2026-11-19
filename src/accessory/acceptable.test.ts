import * as hap from '@homebridge/hap-nodejs';
import { describe, expect, it } from 'vitest';
import { acceptableValue } from './acceptable.ts';

const { Characteristic } = hap;

/** the warnings HAP-NodeJS has about the value, which is what the function is there to prevent */
function warningsFor(characteristic: hap.Characteristic, value: unknown): string[] {
  const warnings: string[] = [];
  characteristic.on('characteristic-warning', (_type, message) => warnings.push(message));
  characteristic.updateValue(value as hap.CharacteristicValue);
  return warnings;
}

describe('acceptableValue', () => {
  it.each([
    ['a number in the range', () => new Characteristic.Brightness(), 40, 40],
    ['a number as text', () => new Characteristic.Brightness(), '40', '40'],
    ['a boolean for a number', () => new Characteristic.Brightness(), true, true],
    ['a number above the range', () => new Characteristic.Brightness(), 254, 100],
    ['a number below the range', () => new Characteristic.Brightness(), -5, 0],
    ['text above the range', () => new Characteristic.ContactSensorState(), '20', 1],
    ['a negative number for an unsigned format', () => new Characteristic.Active(), -1, 0],
    ['text that is no number', () => new Characteristic.CurrentTemperature(), 'unknown', undefined],
    ['not a number', () => new Characteristic.CurrentTemperature(), NaN, undefined],
    ['infinity', () => new Characteristic.CurrentTemperature(), Infinity, undefined],
    ['nothing', () => new Characteristic.CurrentTemperature(), undefined, undefined],
    ['null', () => new Characteristic.CurrentTemperature(), null, undefined],
    ['a boolean', () => new Characteristic.On(), true, true],
    ['a number for a boolean', () => new Characteristic.On(), 1, 1],
    ['an object for a boolean', () => new Characteristic.On(), {}, undefined],
    ['text', () => new Characteristic.Name(), 'lamp', 'lamp'],
    ['a number for text', () => new Characteristic.Name(), 42, '42'],
    ['text that is too long', () => new Characteristic.Name(), 'x'.repeat(70), 'x'.repeat(64)],
    ['an object for text', () => new Characteristic.Name(), {}, undefined],
  ])('makes of %s what the characteristic takes', (_what, create, value, expected) => {
    expect(acceptableValue(create(), value)).toBe(expected);
    // undefined stands for keeping the value the characteristic has
    expect(warningsFor(create(), expected ?? create().value)).toEqual([]);
  });

  it('replaces a value that is not among the valid values by the current one, or by the first valid one', () => {
    const state = new Characteristic.TargetHeatingCoolingState();
    state.setProps({ validValues: [1, 2] });

    state.value = 2;
    expect(acceptableValue(state, 3)).toBe(2);
    expect(acceptableValue(state, 1)).toBe(1);

    state.value = 0;
    expect(acceptableValue(state, 3)).toBe(1);
  });

  it('keeps to the range the mapping gave the characteristic', () => {
    const temperature = new Characteristic.TargetTemperature();
    temperature.setProps({ minValue: 5, maxValue: 30 });

    expect(acceptableValue(temperature, 4)).toBe(5);
    expect(acceptableValue(temperature, 31.5)).toBe(30);
    expect(acceptableValue(temperature, 21.5)).toBe(21.5);
  });
});
