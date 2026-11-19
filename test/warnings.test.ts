// HAP-NodeJS raises a `characteristic-warning` for every value a characteristic does not allow:
// undefined, text for a number, a number outside the range or the valid values. homebridge prints
// each as "This plugin generated a warning from the characteristic ...", and HomeKit shows an
// accessory with such a value as not responding. so no device may cause one.
import type { Characteristic, Service } from '@homebridge/hap-nodejs';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { fixtureDevices } from './support/devices.ts';
import { createWorld, hap } from './support/subject.ts';

// the fixtures that do raise warnings, with the reason. an entry that is not needed fails the test as well.
const known: Record<string, string[] | undefined> = {};

/** the warnings HAP-NodeJS raises while the call runs, as `<characteristic>: <message>` */
async function warningsOf(call: () => void | Promise<void>): Promise<string[]> {
  const warnings: string[] = [];
  const spy = vi.spyOn(hap.Characteristic.prototype as unknown as { characteristicWarning(message: string, type?: string): void }, 'characteristicWarning');
  spy.mockImplementation(function (this: Characteristic, message: string, type?: string) {
    // HAP-NodeJS itself corrects the value of a characteristic whose properties change, and notes that for debugging only
    if (type !== 'debug-message') {
      warnings.push(`${this.displayName}: ${message}`);
    }
  });
  try {
    await call();
  } finally {
    spy.mockRestore();
  }
  return warnings;
}

const characteristicsOf = (services: Service[]): Characteristic[] =>
  services.filter((service) => service instanceof hap.Service).flatMap((service) => service.characteristics);

afterEach(() => {
  vi.restoreAllMocks();
});

describe.each(fixtureDevices())('$id', (fixture) => {
  it('gives HomeKit no value it rejects', async () => {
    const world = createWorld({
      jsFunctions: {
        byteToPercent: (_mapping: unknown, orig: string) => Math.round(Number(orig) / 2.55),
        percentToByte: (_mapping: unknown, orig: number) => Math.round(orig * 2.55),
        throws: () => {
          throw new Error('boom');
        },
        notANumber: () => NaN,
      },
      respond: (cmd) => (cmd.startsWith('{ReadingsVal(') ? '19.5' : undefined),
    });
    const device = fixture.load();
    const accessory = world.accessory(device);
    if (accessory.service_name === undefined) {
      return;
    }

    const warnings = await warningsOf(async () => {
      const characteristics = characteristicsOf(accessory.getServices());

      // the values the services start with, as HomeKit gets them with the list of accessories
      for (const characteristic of characteristics) {
        (characteristic as unknown as { validateUserInput(value: unknown): unknown }).validateUserInput(characteristic.value);
      }

      // HomeKit reads every characteristic
      for (const characteristic of characteristics) {
        if (characteristic.props.perms.includes(hap.Perms.PAIRED_READ)) {
          await characteristic.handleGetRequest().catch(() => undefined);
        }
      }

      // fhem reports every reading of the device again
      for (const [reading, entry] of Object.entries(device.Readings)) {
        const informId = `${device.Internals.NAME}-${reading}`;
        if (entry && world.subscriptions[informId]) {
          delete world.cached[informId];
          world.update(informId, entry.Value);
        }
      }
    });

    expect(warnings).toEqual(known[fixture.id] ?? []);
  });
});

it('names no fixture as known to warn that does not exist', () => {
  const ids = new Set(fixtureDevices().map((fixture) => fixture.id));
  expect(Object.keys(known).filter((id) => !ids.has(id))).toEqual([]);
});
