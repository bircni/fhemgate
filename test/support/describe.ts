// turns what the plugin builds into plain data that can be recorded and compared
import type { Characteristic, Service } from '@homebridge/hap-nodejs';
import { hap } from './subject.ts';
import type { Accessory, Mapping } from './types.ts';

const characteristicNames = new Map<unknown, string>(
  Object.entries(hap.Characteristic as unknown as Record<string, unknown>)
    .filter(([, value]) => typeof value === 'function')
    .map(([name, value]) => [value, name]),
);

function describeValue(key: string, value: unknown): unknown {
  if (key === 'characteristic') {
    if (typeof value === 'function') {
      return `class ${characteristicNames.get(value) ?? '?'}`;
    }
    if (typeof value === 'object' && value !== null) {
      const characteristic = value as Characteristic;
      return `instance ${characteristic.displayName} ${characteristic.UUID}`;
    }
  }
  if (typeof value === 'function') {
    return '[function]';
  }
  return value;
}

export function describeMapping(mapping: Mapping): Record<string, unknown> {
  const described: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(mapping)) {
    if (key !== 'log') {
      described[key] = describeValue(key, value);
    }
  }
  return described;
}

/** every mapping of the accessory with a label, a characteristic with several mappings numbered */
export function eachMapping(accessory: Accessory): [label: string, mapping: Mapping][] {
  return Object.entries(accessory.mappings).flatMap(([type, mappings]): [string, Mapping][] => {
    if (Array.isArray(mappings)) {
      return mappings.map((mapping, index) => [`${type}[${index}]`, mapping]);
    }
    return typeof mappings === 'object' ? [[type, mappings]] : [];
  });
}

export function describeMappings(accessory: Accessory): Record<string, unknown> {
  const described: Record<string, unknown> = {};
  for (const [type, mappings] of Object.entries(accessory.mappings)) {
    if (Array.isArray(mappings)) {
      described[type] = mappings.map(describeMapping);
    } else if (typeof mappings === 'object') {
      described[type] = describeMapping(mappings);
    } else {
      described[type] = mappings;
    }
  }
  return described;
}

export function describeIdentity(accessory: Accessory): Record<string, unknown> {
  return {
    service_name: accessory.service_name,
    name: accessory.name,
    alias: accessory.alias,
    siriName: accessory.siriName,
    device: accessory.device,
    type: accessory.type,
    model: accessory.model,
    serial: accessory.serial,
    uuid_base: accessory.uuid_base,
    // homebridge derives the uuid of the accessory from these two. it must not change, or
    // homekit takes the accessory for a new one and forgets its room and automations.
    homekit_uuid: hap.uuid.generate(`FHEM:${accessory.uuid_base ?? accessory.name ?? ''}`),
    fuuid: accessory.fuuid,
    room: accessory.room,
    category: accessory.category,
  };
}

function describeCharacteristic(characteristic: Characteristic): Record<string, unknown> {
  const { format, unit, minValue, maxValue, minStep, perms, validValues } = characteristic.props;
  return {
    name: characteristic.displayName,
    uuid: characteristic.UUID,
    value: characteristic.value,
    props: { format, unit, minValue, maxValue, minStep, perms, validValues },
  };
}

export function describeService(service: Service): Record<string, unknown> {
  // the history service of fakegato-history is no hap service class
  if (!(service instanceof hap.Service)) {
    return { type: (service as object).constructor.name };
  }

  return {
    type: service.constructor.name,
    name: service.displayName,
    uuid: service.UUID,
    subtype: service.subtype,
    linked: service.linkedServices.map((linked) => `${linked.constructor.name} ${linked.subtype ?? ''}`.trim()),
    characteristics: service.characteristics.map(describeCharacteristic),
  };
}

/** one line per distinct result, listing the inputs that led to it */
export function groupByResult(results: [input: unknown, result: string][]): string[] {
  const groups = new Map<string, string[]>();
  for (const [input, result] of results) {
    const inputs = groups.get(result) ?? [];
    inputs.push(JSON.stringify(input));
    groups.set(result, inputs);
  }
  return [...groups].map(([result, inputs]) => `${result} <- ${inputs.join(' ')}`);
}

/** the result of a call, or what it threw */
export function outcome(call: () => unknown): string {
  try {
    const value = call();
    return value === undefined ? 'undefined' : JSON.stringify(value);
  } catch (error) {
    return `throws ${String(error)}`;
  }
}
