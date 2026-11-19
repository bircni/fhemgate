// what HomeKit controllers are told when a reading changes in fhem. HAP-NodeJS sends an event to
// the controllers that are subscribed to a characteristic for every `change` of it, so the tests
// listen where the accessory of HAP-NodeJS does.
import type { Characteristic as HapCharacteristic, CharacteristicChange, Service } from '@homebridge/hap-nodejs';
import { describe, expect, it } from 'vitest';
import { device } from './support/devices.ts';
import { characteristicOf, serviceOf } from './support/homekit.ts';
import { createWorld, hap } from './support/subject.ts';

const { Characteristic } = hap;

const lamp = () => device({ Internals: { NAME: 'lamp' }, Readings: { state: 'on' }, PossibleSets: 'on off toggle' });

/** the changes of the characteristic as its service hands them to the accessory of HAP-NodeJS, which sends the events */
function published(services: Service[], characteristic: HapCharacteristic): CharacteristicChange[] {
  const changes: CharacteristicChange[] = [];
  for (const service of services) {
    service.on('characteristic-change', (change) => {
      if (change.characteristic === characteristic) {
        changes.push(change);
      }
    });
  }
  return changes;
}

describe('a reading that changes in fhem', () => {
  it('is published to HomeKit at once, as an update and not as a write', () => {
    const world = createWorld();
    const services = world.accessory(lamp()).getServices();
    const on = characteristicOf(serviceOf(services, 'Switch'), Characteristic.On);
    const changes = published(services, on);

    world.update('lamp-state', 'off');

    expect(changes.map(({ oldValue, newValue, reason, originator }) => ({ oldValue, newValue, reason, originator }))).toEqual([
      { oldValue: true, newValue: false, reason: 'update', originator: undefined },
    ]);
    expect(on.value).toBe(false);
  });

  it('is published for every change', () => {
    const world = createWorld();
    const services = world.accessory(lamp()).getServices();
    const on = characteristicOf(serviceOf(services, 'Switch'), Characteristic.On);
    const changes = published(services, on);

    for (const value of ['off', 'on', 'off', 'on']) {
      world.update('lamp-state', value);
    }

    expect(changes.map((change) => change.newValue)).toEqual([false, true, false, true]);
  });

  it('does not run the set handler, so nothing is sent back to fhem', () => {
    const world = createWorld();
    const services = world.accessory(lamp()).getServices();
    const on = characteristicOf(serviceOf(services, 'Switch'), Characteristic.On);
    let written = 0;
    on.on('set', () => {
      written++;
    });

    world.update('lamp-state', 'off');

    expect(written).toBe(0);
    expect(world.sent).toEqual([]);
  });
});

describe('a value HomeKit writes', () => {
  it('is sent to fhem once, and the event fhem answers with is not sent back', async () => {
    const world = createWorld();
    const services = world.accessory(lamp()).getServices();
    const on = characteristicOf(serviceOf(services, 'Switch'), Characteristic.On);
    const changes = published(services, on);

    // the way a write of a controller reaches the characteristic
    await on.handleSetRequest(false, undefined);
    world.update('lamp-state', 'off');

    expect(world.sent).toEqual(['set lamp off']);
    expect(changes.map((change) => change.reason)).toEqual(['write', 'update']);
  });
});
