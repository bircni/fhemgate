import type { Characteristic } from '@homebridge/hap-nodejs';
import type { HistoryService } from '../accessory/history.ts';
import type { Mapping, Mappings, PreparedMapping } from '../mapping/types.ts';

/** what the plugin needs to know of an accessory that listens to readings */
export interface SubscribedAccessory {
  /** the name of the fhem device */
  device?: string;
  mappings: Mappings;
  historyService?: HistoryService;
  /** set once the history was saved for the shutdown of homebridge */
  shutdown?: boolean;
}

/** a characteristic, with the mapping it was subscribed with kept at it for the debug page */
export type MappedCharacteristic = Characteristic & { FHEM_mapping?: Mapping };

export interface Subscription {
  accessory: SubscribedAccessory;
  characteristic?: MappedCharacteristic;
  /** missing for a subscription that only keeps a reading in the cache */
  mapping?: PreparedMapping;
}

/** who wants to hear about which reading. events from fhem for other readings are dropped. */
export class Subscriptions {
  /** the subscriptions by `<device>-<reading>` */
  readonly byInformId: Record<string, Subscription[] | undefined> = {};

  subscribe(accessory: SubscribedAccessory, informId: string, characteristic?: Characteristic, mapping?: PreparedMapping): void {
    const subscriptions = (this.byInformId[informId] ??= []);

    subscriptions.push({ accessory: accessory, characteristic: characteristic, mapping: mapping });
  }

  /** removes the subscriptions of the accessory to the reading that were made for this characteristic */
  unsubscribe(accessory: SubscribedAccessory, informId: string, characteristic?: Characteristic): void {
    const subscriptions = this.byInformId[informId];
    if (subscriptions) {
      const remaining = subscriptions.filter((subscription) => subscription.accessory !== accessory || subscription.characteristic !== characteristic);

      if (remaining.length) {
        this.byInformId[informId] = remaining;
      } else {
        delete this.byInformId[informId];
      }
    }
  }

  /** the accessory that is subscribed to a reading of the device, if there is one */
  publishedAccessory(device: string): SubscribedAccessory | null {
    for (const subscriptions of Object.values(this.byInformId)) {
      for (const subscription of subscriptions ?? []) {
        if (subscription.accessory.device === device) {
          return subscription.accessory;
        }
      }
    }

    return null;
  }
}
