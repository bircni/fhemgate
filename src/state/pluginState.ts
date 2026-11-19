import type { Characteristic } from '@homebridge/hap-nodejs';
import type { HAP } from 'homebridge';
import { acceptableValue } from '../accessory/acceptable.ts';
import { recordHistory, type HistoryServiceClass } from '../accessory/history.ts';
import type { ConnectionStatus } from '../fhem/client.ts';
import { reading2homekit } from '../mapping/toHomekit.ts';
import { toInt } from '../util/loose.ts';
import { ReadingCache } from './readingCache.ts';
import { Subscriptions } from './subscriptions.ts';

// offset in milliseconds, for the time in the log. worked out once, so it is off after a change
// to or from daylight saving time until homebridge is started again.
const tzoffset = new Date().getTimezoneOffset() * 60000;

/**
 * What the plugin knows while it runs: the readings it has seen and who listens to them.
 * There is one for all FHEM platforms of a homebridge, so a device is only published once even
 * if two platforms select it.
 */
export class PluginState {
  readonly cache = new ReadingCache();
  readonly subscriptions = new Subscriptions();

  /** how the long poll to each fhem is doing, by the url of its FHEMWEB */
  readonly longpoll: Record<string, ConnectionStatus | undefined> = {};
  /**
   * The csrf token of each FHEMWEB, by its url. Not there before FHEMWEB answered for the first
   * time, and empty for a FHEMWEB that has none.
   */
  readonly csrfToken: Record<string, string | undefined> = {};

  /** the history service of the fakegato-history package for this homebridge, if the package is installed */
  historyServiceClass?: HistoryServiceClass;

  constructor(readonly hap: HAP) {}

  /**
   * A reading has a new value, from an event of fhem or an answer to a query. Converts it for
   * every characteristic that is subscribed to the reading and hands it to HomeKit.
   *
   * @param noUpdate keep the value in the cache and at the mappings, but do not tell HomeKit
   */
  update(informId: string, orig: unknown, noUpdate?: boolean): void {
    if (orig === undefined) {
      return;
    }

    // an event that repeats the value the reading has says nothing new to most characteristics.
    // it is another press for a button, and a mapping that is not cached takes every event.
    const repeated = this.cache.values[informId] === orig;
    const subscriptions = this.subscriptions.byInformId[informId];

    if (!repeated) {
      this.cache.values[informId] = orig;
      const date = new Date(Date.now() - tzoffset).toISOString().replace(/T/, ' ').replace(/\..+/, '');
      // eslint-disable-next-line @typescript-eslint/no-base-to-string -- readings are text. what else is cached is printed as it comes.
      console.log('  ' + date + ' caching: ' + informId + ': ' + String(orig));
    }

    if (subscriptions) {
      subscriptions.forEach((subscription) => {
        const mapping = subscription.mapping;
        if (typeof mapping !== 'object') {
          return;
        }

        const characteristic = typeof mapping.characteristic === 'object' ? mapping.characteristic : undefined;
        const eventOnly = characteristic !== undefined && this.#isEventOnly(characteristic);
        if (repeated && !eventOnly && !mapping.nocache) {
          return;
        }

        mapping.last_update = toInt(Date.now() / 1000);

        const value = reading2homekit(mapping, orig);
        if (value === undefined) {
          return;
        }

        const accessory = subscription.accessory;
        if (accessory.historyService) {
          recordHistory(accessory, accessory.historyService, mapping, value, this);
        }

        if (!noUpdate && characteristic) {
          const accepted = acceptableValue(characteristic, value);
          if (accepted === undefined) {
            mapping.log.debug(informId + ': ' + String(value) + ' is no value for ' + characteristic.displayName + ', which keeps the one it has');
          } else if (eventOnly) {
            // announced also when the value is the one before: two presses in a row are two events
            characteristic.sendEventNotification(accepted);
          } else {
            // updateValue tells the HomeKit controllers that are subscribed to the characteristic, and
            // does not run its set handler: the value is not sent back to fhem
            characteristic.updateValue(accepted);
          }
        }
      });
    }
  }

  /** whether the characteristic reports things that happen, like the press of a button, and has no state of its own */
  #isEventOnly(characteristic: Characteristic): boolean {
    const { ProgrammableSwitchEvent, ButtonEvent } = this.hap.Characteristic;
    return characteristic.UUID === ProgrammableSwitchEvent.UUID || characteristic.UUID === ButtonEvent.UUID;
  }
}
