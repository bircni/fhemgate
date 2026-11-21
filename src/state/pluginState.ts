import type { Characteristic } from '@homebridge/hap-nodejs';
import type { HAP } from 'homebridge';
import { acceptableValue } from '../accessory/acceptable.ts';
import { recordHistory, type HistoryService, type HistoryServiceClass } from '../accessory/history.ts';
import type { ConnectionStatus } from '../fhem/client.ts';
import { reading2homekit } from '../mapping/toHomekit.ts';
import { isNocache } from '../mapping/types.ts';
import { toInt } from '../util/loose.ts';
import { ReadingCache } from './readingCache.ts';
import { Subscriptions } from './subscriptions.ts';

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

  /**
   * The histories of each device, by its FUUID and their type. An accessory that is built again for a device takes
   * the history it had, also after it was removed and comes back: fakegato-history keeps one writer per file and
   * has no way to stop one.
   */
  readonly histories = new Map<string, Map<string, HistoryService>>();

  /** how many values of each reading were taken that are no answers, see changesOf */
  readonly #changes = new Map<string, number>();

  constructor(readonly hap: HAP) {}

  /**
   * A reading has a new value, from an event of fhem or an answer to a query. Converts it for
   * every characteristic that is subscribed to the reading and hands it to HomeKit.
   *
   * @param noUpdate keep the value in the cache and at the mappings, but do not tell HomeKit
   */
  update(informId: string, orig: unknown, noUpdate?: boolean): void {
    this.#take(informId, orig, noUpdate ? 'quiet' : 'event');
  }

  /**
   * What fhem answered when it was asked for a reading, which is no change that happened: as an
   * update, but a characteristic that tells of the presses of a button is not told of it.
   */
  answer(informId: string, orig: unknown): void {
    this.#take(informId, orig, 'answer');
  }

  /** What fhem answered to a read from HomeKit, which gets it as its answer: as an answer, but HomeKit is not told. */
  answerRead(informId: string, orig: unknown): void {
    this.#take(informId, orig, 'read');
  }

  /**
   * Forgets a reading fhem no longer has: its value, when it changed, and what the mappings that
   * follow it know of it, which is their default now. That is a change: an answer asked for
   * before it does not bring the reading back.
   */
  forget(informId: string): void {
    delete this.cache.values[informId];
    delete this.cache.changed[informId];
    this.#changes.set(informId, this.changesOf(informId) + 1);
    this.subscriptions.byInformId[informId]?.forEach((subscription) => {
      if (typeof subscription.mapping === 'object') {
        subscription.mapping.cached = subscription.mapping.default;
        delete subscription.mapping.last_update;
      }
    });
  }

  /**
   * How many values of the reading the plugin took that are no answers of fhem it asked for: the
   * events of fhem, and the values the plugin sets itself, such as the colour HomeKit was given.
   * An answer of fhem that was asked before the count changed is older than what the plugin knows.
   */
  changesOf(informId: string): number {
    return this.#changes.get(informId) ?? 0;
  }

  /**
   * @param source an event, a value the plugin sets itself and HomeKit is not told of, an answer of
   * fhem, or one to a read from HomeKit, which is not told of it either
   */
  #take(informId: string, orig: unknown, source: 'event' | 'quiet' | 'answer' | 'read'): void {
    if (orig === undefined) {
      return;
    }
    const now = toInt(Date.now() / 1000);
    const answered = source === 'answer' || source === 'read';
    if (!answered) {
      this.#changes.set(informId, this.changesOf(informId) + 1);
    }

    // an event that repeats the value the reading has says nothing new to most characteristics.
    // it is another press for a button, and a mapping that is not cached takes every event.
    const repeated = this.cache.values[informId] === orig;
    const subscriptions = this.subscriptions.byInformId[informId];

    if (!repeated) {
      this.cache.values[informId] = orig;
      this.cache.changed[informId] = now;
      // logged where the first characteristic that follows the reading logs
      // eslint-disable-next-line @typescript-eslint/no-base-to-string -- readings are text. what else is cached is printed as it comes.
      subscriptions?.find((subscription) => subscription.mapping)?.mapping?.log.debug('caching: ' + informId + ': ' + String(orig));
    }

    if (subscriptions) {
      subscriptions.forEach((subscription) => {
        const mapping = subscription.mapping;
        if (typeof mapping !== 'object') {
          return;
        }

        const characteristic = typeof mapping.characteristic === 'object' ? mapping.characteristic : undefined;
        const eventOnly = characteristic !== undefined && this.#isEventOnly(characteristic);
        if ((repeated && !eventOnly && !isNocache(mapping)) || (answered && eventOnly)) {
          return;
        }

        mapping.last_update = now;

        const value = reading2homekit(mapping, orig);
        if (value === undefined) {
          return;
        }

        const accessory = subscription.accessory;
        if (accessory.historyService) {
          recordHistory(accessory, accessory.historyService, mapping, value, this);
        }

        if ((source === 'event' || source === 'answer') && characteristic) {
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
