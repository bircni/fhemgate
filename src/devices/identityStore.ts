// remembers what each device was first published as, so that it stays the same accessory for
// HomeKit when what the plugin works its identity out from changes
import { readFileSync, renameSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import type { Logging } from 'homebridge';

/** the file in the storage directory of homebridge */
export const IDENTITIES_FILE = 'fhemgate-identities.json';

interface Stored {
  version: 1;
  /** what homebridge makes the uuid of the accessory from, by the key of the device */
  identities: Record<string, string>;
}

/**
 * The identity each device was published with for the first time. homebridge makes the uuid of
 * an accessory from it, and HomeKit takes an accessory with another uuid for a new one and
 * forgets its room, name and automations. The plugin works the identity out from what fhem
 * reports, and for some devices that is not the same on every start: a HUEDevice has its
 * `uniqueid` only once the bridge has answered.
 *
 * Nothing here may stop the platform: a file that is missing, damaged or can not be written is
 * reported and the plugin goes on with what it has.
 */
export class IdentityStore {
  readonly #file: string;
  #identities: Record<string, string> | undefined;
  #changed = false;

  constructor(storagePath: string) {
    this.#file = join(storagePath, IDENTITIES_FILE);
  }

  /** the identities of the file. empty if there is none yet or it can not be read. */
  #load(log: Logging): Record<string, string> {
    if (this.#identities) {
      return this.#identities;
    }

    const identities: Record<string, string> = {};
    try {
      const stored = JSON.parse(readFileSync(this.#file, 'utf8')) as Partial<Stored> | null;
      for (const [key, identity] of Object.entries(stored?.identities ?? {})) {
        if (typeof identity === 'string' && identity) {
          identities[key] = identity;
        }
      }
    } catch (error) {
      if ((error as { code?: string }).code !== 'ENOENT') {
        log.warn(this.#file + ' can not be read and is started anew (' + String(error) + ')');
      }
    }

    this.#identities = identities;
    return identities;
  }

  /**
   * The identity to publish the device with: the one it was first published with, or else the
   * one that was worked out now, which is remembered from here on.
   */
  resolve(key: string, computed: string, log: Logging): string {
    const identities = this.#load(log);
    const remembered = identities[key];
    if (remembered !== undefined) {
      if (remembered !== computed) {
        log.debug(key + ' stays ' + remembered + ' for HomeKit, as it was first published. it would be ' + computed + ' now.');
      }
      return remembered;
    }

    identities[key] = computed;
    this.#changed = true;
    return computed;
  }

  /** writes the file if something was added. the old file stays whole if writing fails halfway. */
  save(log: Logging): void {
    if (!this.#changed || !this.#identities) {
      return;
    }

    const stored: Stored = { version: 1, identities: this.#identities };
    const temporary = this.#file + '.tmp';
    try {
      writeFileSync(temporary, JSON.stringify(stored, null, 2) + '\n');
      renameSync(temporary, this.#file);
      this.#changed = false;
    } catch (error) {
      log.warn(this.#file + ' can not be written. devices may change their identity for HomeKit on a later start (' + String(error) + ')');
    }
  }
}

/**
 * What a device is remembered by: the FUUID fhem gave it, which stays when the device is renamed.
 * A fhem too old to have one leaves the name, together with the fhem it belongs to.
 */
export function identityKey(baseUrl: string | undefined, name: string, fuuid: string | undefined): string {
  return fuuid ? fuuid : (baseUrl ?? '') + '#' + name;
}
