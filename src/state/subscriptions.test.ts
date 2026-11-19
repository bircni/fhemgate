import { describe, expect, it } from 'vitest';
import { Characteristic } from '@homebridge/hap-nodejs';
import { Subscriptions, type SubscribedAccessory } from './subscriptions.ts';

const accessory = (device: string): SubscribedAccessory => ({ device, mappings: {} });
const characteristic = (name: string) => new Characteristic(name, '00000000-0000-1000-8000-0026BB765291', { format: 'bool', perms: [] });

describe('Subscriptions', () => {
  it('keeps the subscriptions to a reading in the order they were made', () => {
    const subscriptions = new Subscriptions();
    const lamp = accessory('lamp');
    const [on, brightness] = [characteristic('On'), characteristic('Brightness')];

    subscriptions.subscribe(lamp, 'lamp-pct', on);
    subscriptions.subscribe(lamp, 'lamp-pct', brightness);

    expect(subscriptions.byInformId['lamp-pct']?.map((subscription) => subscription.characteristic)).toEqual([on, brightness]);
  });

  it('removes only the subscription of the given accessory and characteristic', () => {
    const subscriptions = new Subscriptions();
    const [lamp, other] = [accessory('lamp'), accessory('other')];
    const on = characteristic('On');
    subscriptions.subscribe(lamp, 'x', on);
    subscriptions.subscribe(other, 'x', on);
    subscriptions.subscribe(lamp, 'x');

    subscriptions.unsubscribe(lamp, 'x', on);

    expect(subscriptions.byInformId.x).toEqual([
      { accessory: other, characteristic: on, mapping: undefined },
      { accessory: lamp, characteristic: undefined, mapping: undefined },
    ]);
  });

  it('forgets a reading nobody is subscribed to any more', () => {
    const subscriptions = new Subscriptions();
    const lamp = accessory('lamp');
    subscriptions.subscribe(lamp, 'x');

    subscriptions.unsubscribe(lamp, 'x');
    subscriptions.unsubscribe(lamp, 'never');

    expect(subscriptions.byInformId).toEqual({});
  });

  it('finds the accessory of a device by any of its subscriptions', () => {
    const subscriptions = new Subscriptions();
    const lamp = accessory('lamp');
    subscriptions.subscribe(accessory('other'), 'other-state');
    subscriptions.subscribe(lamp, 'lamp-state');

    expect(subscriptions.publishedAccessory('lamp')).toBe(lamp);
    expect(subscriptions.publishedAccessory('nobody')).toBeNull();
  });
});
