// helpers for the suites taken over from the node test runner of homebridge-fhem. they keep
// the shape those tests were written in: build a HMCCU device, look at the mappings.
import { expect } from 'vitest';
import { hmccuDevice, type DeviceOptions } from './devices.ts';
import { createWorld, type World } from './subject.ts';
import type { Accessory, FhemDevice } from './types.ts';

/** a mapping where everything a test looks at is assumed to be there */
export interface PortedMapping {
  reading: string;
  cmd: string;
  cmdOn: string;
  cmdOff: string;
  informId: string;
  cached: unknown;
  default: unknown;
  factor: number;
  minValue: number;
  maxValue: number;
  minStep: number;
  readOnly?: boolean;
  reading2homekit(value: unknown): unknown;
  homekit2reading(value: unknown): unknown;
}

export type PortedMappings = Record<string, PortedMapping>;

export interface PortedAccessory extends Omit<Accessory, 'mappings'> {
  mappings: PortedMappings;
  sent: string[];
}

let world: World | undefined;

export const device = (options: DeviceOptions): FhemDevice => hmccuDevice(options);

/** runs the HMCCU detection on its own, without the rest of the accessory */
export function mappingsFor(d: FhemDevice, genericType?: string): { handled: boolean; accessory: { mappings: PortedMappings; service_name?: string } } {
  world = createWorld();
  const result = world.hmccuMappings(d, genericType);
  return { handled: result.handled, accessory: result.accessory as unknown as { mappings: PortedMappings; service_name?: string } };
}

/** creates the whole accessory */
export function accessoryFor(d: FhemDevice): PortedAccessory {
  world = createWorld();
  const accessory = world.accessory(d) as unknown as PortedAccessory;
  accessory.sent = world.sent;
  return accessory;
}

/** what the last accessory logged as error */
export function errors(): string[] {
  return world?.log.errors() ?? [];
}

export function check(name: string, condition: unknown, actual?: unknown): void {
  expect(condition, actual === undefined ? name : `${name} -> ${JSON.stringify(actual)}`).toBeTruthy();
}

/** asserts the fhem command produced for a characteristic */
export function command(accessory: PortedAccessory, characteristicType: string, value: unknown, expected: string): void {
  accessory.sent.length = 0;
  accessory.command(accessory.mappings[characteristicType] as unknown as string, value);
  expect(accessory.sent[0], `${characteristicType}(${String(value)})`).toBe(expected);
}
