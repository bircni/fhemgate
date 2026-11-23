// a light behind a CCU as HMCCU reports it: LEVEL holds the words off and on at the ends of its
// range. the device is the captured HmIP-RGBW, which also has a pct reading through its
// ccureadingname attribute.
import { describe, expect, it } from 'vitest';
import { fixtureDevice } from '../support/devices.ts';
import { characteristicOf, serviceOf } from '../support/homekit.ts';
import { createWorld } from '../support/subject.ts';
import type { FhemDevice, Mapping } from '../support/types.ts';

/** the captured light with its readings set, and the reading for the level that HMCCU makes */
function rgbw(readings: Record<string, string>, change: (device: FhemDevice) => void = () => {}) {
  const device = fixtureDevice('hmccu/captured/hmip-rgbw-7');
  for (const [name, value] of Object.entries(readings)) {
    device.Readings[name] = { Value: value, Time: '2026-11-22 18:00:00' };
  }
  change(device);

  const world = createWorld();
  const accessory = world.accessory(device);
  const light = serviceOf(accessory.getServices(), 'Lightbulb');
  return {
    world,
    accessory,
    on: characteristicOf(light, 'On'),
    brightness: characteristicOf(light, 'Brightness'),
  };
}

/** the reading a characteristic of the accessory follows */
function readingOf(accessory: { mappings: Record<string, unknown> }, characteristic: string): string | undefined {
  return (accessory.mappings[characteristic] as Mapping | undefined)?.reading;
}

/** the same light without the ccureadingname attribute: no pct reading, only LEVEL */
function withoutPct(device: FhemDevice): void {
  delete device.Readings.pct;
  delete device.Readings.pct_STATUS;
  delete device.Attributes.ccureadingname;
}

describe('a HMCCU light whose LEVEL is a word', () => {
  it('is off when it is off, as captured', () => {
    const { on, brightness } = rgbw({});

    expect(on.value).toBe(false);
    expect(brightness.value).toBe(0);
  });

  it('reads the pct reading, which stays a number', () => {
    const { accessory, on, brightness } = rgbw({ LEVEL: '0.5', pct: '50', state: '50' });

    expect(readingOf(accessory, 'On')).toBe('pct');
    expect(readingOf(accessory, 'Brightness')).toBe('pct');
    expect(on.value).toBe(true);
    expect(brightness.value).toBe(50);
  });

  it('is fully on when pct is 100 and LEVEL says on', () => {
    const { on, brightness } = rgbw({ LEVEL: 'on', pct: '100', state: 'on' });

    expect(on.value).toBe(true);
    expect(brightness.value).toBe(100);
  });

  it('follows pct when it changes', () => {
    const { world, on, brightness } = rgbw({});

    world.update('hmip_rgbw_7-pct', '70');
    expect(on.value).toBe(true);
    expect(brightness.value).toBe(70);

    world.update('hmip_rgbw_7-pct', '0');
    expect(on.value).toBe(false);
  });

  describe('without a pct reading', () => {
    it('takes off in LEVEL for off', () => {
      const { accessory, on, brightness } = rgbw({}, withoutPct);

      expect(readingOf(accessory, 'On')).toBe('LEVEL');
      expect(on.value).toBe(false);
      expect(brightness.value).toBe(0);
    });

    it('takes on in LEVEL for fully on', () => {
      const { on, brightness } = rgbw({ LEVEL: 'on', state: 'on' }, withoutPct);

      expect(on.value).toBe(true);
      expect(brightness.value).toBe(100);
    });

    it('scales a LEVEL between the ends from 0 to 1', () => {
      const { on, brightness } = rgbw({ LEVEL: '0.3', state: '30' }, withoutPct);

      expect(on.value).toBe(true);
      expect(brightness.value).toBe(30);
    });
  });
});
