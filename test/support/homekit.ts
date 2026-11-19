// what homekit does with an accessory: read a characteristic, write one
import type { Characteristic, CharacteristicValue, Service, WithUUID } from '@homebridge/hap-nodejs';
import type { Accessory } from './types.ts';

export type CharacteristicClass = WithUUID<new () => Characteristic>;

/** the service of the given kind, the one with the subtype if there are several */
export function serviceOf(services: Service[], type: string, subtype?: string): Service {
  const service = services.find((candidate) => candidate.constructor.name === type && (subtype === undefined || candidate.subtype === subtype));
  if (!service) {
    throw new Error(`no ${type} service among ${services.map((candidate) => candidate.constructor.name).join(', ')}`);
  }
  return service;
}

/** the characteristic of a service, by class or by the name it was given */
export function characteristicOf(service: Service, type: CharacteristicClass | string): Characteristic {
  const characteristic = typeof type === 'string'
    ? service.characteristics.find((candidate) => candidate.displayName === type)
    : service.characteristics.find((candidate) => candidate.UUID === type.UUID);
  if (!characteristic) {
    throw new Error(`no such characteristic among ${service.characteristics.map((candidate) => candidate.displayName).join(', ')}`);
  }
  return characteristic;
}

export interface ReadResult {
  error: unknown;
  value: unknown;
  /** false if the plugin never answered */
  answered: boolean;
}

/** homekit asks for the value of a characteristic */
export function read(characteristic: Characteristic): ReadResult {
  const result: ReadResult = { error: undefined, value: undefined, answered: false };
  characteristic.emit('get', (error, value) => {
    result.error = error;
    result.value = value;
    result.answered = true;
  }, undefined);
  return result;
}

/** homekit, or the plugin itself with the context 'fromFHEM', sets the value of a characteristic */
export function write(characteristic: Characteristic, value: CharacteristicValue, context?: string): { answered: boolean } {
  const result = { answered: false };
  characteristic.emit('set', value, () => {
    result.answered = true;
  }, context);
  return result;
}

/** lets the values the plugin handed to homekit arrive at the characteristics */
export function settle(): Promise<void> {
  return new Promise((resolve) => setImmediate(resolve));
}

export function servicesOf(accessory: Accessory): Service[] {
  return accessory.getServices();
}
