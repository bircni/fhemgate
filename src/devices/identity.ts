// what an accessory is called and what HomeKit recognises it by
import type { Mapping, Mappings } from '../mapping/types.ts';
import { sanitizeHapName } from '../util/names.ts';
import type { Jsonlist2Device } from './types.ts';

export interface DeviceIdentity {
  /** the name of the accessory in homebridge: the device name with what HomeKit does not allow replaced */
  name: string;
  /** the unique id fhem gave the device */
  fuuid: string | undefined;
  /** the alias attribute, or the device name */
  alias: string;
  /** what the services are called in HomeKit: the siriName attribute, or the alias */
  siriName: string;
  /** the name of the device in fhem */
  device: string;
  /** the fhem module of the device */
  type: string;
  model: string | undefined;
  PossibleSets: string;
  room: string | undefined;
  /** shown as serial number in HomeKit */
  serial: string | undefined;
  /**
   * homebridge makes the uuid of the accessory from this. HomeKit takes an accessory with another
   * uuid for a new one and forgets its room, name and automations, so this must not change for a
   * device that was published before.
   */
  uuid_base: string | undefined;
}

/** the platform name homebridge-fhem was configured with, which the uuids of its accessories were made from */
export const LEGACY_UUID_PREFIX = 'FHEM';

/**
 * The platform name the uuids of the accessories are made with: what migrateFrom says, or the
 * one of homebridge-fhem, which most of its configurations named.
 */
export function uuidPrefixOf(migrateFrom: unknown): string {
  return typeof migrateFrom === 'string' && migrateFrom.trim() !== '' ? migrateFrom.trim() : LEGACY_UUID_PREFIX;
}

/**
 * The uuid HomeKit knows the accessory of a device by. It is made the way homebridge makes it for
 * an accessory of a static platform, from the platform name the config entry gave, a colon, and
 * the uuid_base or else the name. homebridge-fhem was such a platform, so with the platform name
 * it was configured with every device gets the uuid it had there, and with it its room, name and
 * automations.
 *
 * @param generate the uuid generator of HAP-NodeJS
 * @param prefix the platform name the uuids were made with
 */
export function accessoryUuid(generate: (data: string) => string, prefix: string, identity: { name?: string; uuid_base?: string }): string {
  return generate(prefix + ':' + (identity.uuid_base || identity.name));
}

/**
 * The serial number is taken from what identifies the hardware for the device types where fhem
 * knows that, so it survives when the device is deleted and defined again in fhem. For all other
 * types it is the FUUID.
 *
 * @param remembered answers what the device was first published with, given what was worked out
 * now. Not asked when the SerialNumber mapping says what the serial number is.
 */
export function deviceIdentity(s: Jsonlist2Device, mappings: Mappings, remembered?: (computed: string) => string): DeviceIdentity {
  const type = s.Internals.TYPE;
  const fuuid = s.Internals.FUUID;
  const alias = s.Attributes.alias ? s.Attributes.alias : s.Internals.NAME;

  let model: string | undefined = s.Readings.model
    ? s.Readings.model.Value
    : s.Attributes.model
      ? s.Attributes.model
      : s.Internals.model
        ? s.Internals.model
        : '<unknown>';

  let serial: string | undefined = undefined;
  if (type === 'CUL_HM') {
    serial = type + '.' + s.Internals.DEF;
    if (s.Attributes.serialNr) {
      serial = s.Attributes.serialNr;
    } else if (s.Readings['D-serialNr']?.Value) {
      serial = s.Readings['D-serialNr'].Value;
    }
  } else if (type === 'CUL_WS' || type === 'Siro' || type === 'FS20' || type === 'IT' || type === 'EnOcean') {
    serial = type + '.' + s.Internals.DEF;
  } else if (type === 'HUEDevice') {
    if (s.Internals.uniqueid && s.Internals.uniqueid !== 'ff:ff:ff:ff:ff:ff:ff:ff-0b') {
      serial = s.Internals.uniqueid;
    }
  } else if (type === 'SONOSPLAYER') {
    serial = s.Internals.UDN;
  } else if (type === 'WOL') {
    serial = type + '.' + s.Internals.MAC;
  } else if (type === 'MAX') {
    model = s.Internals.type;
    serial = type + '.' + s.Internals.addr;
  } else if (type === 'DUOFERN') {
    model = s.Internals.SUBTYPE;
    serial = type + '.' + s.Internals.DEF;
  } else if (type === 'ZWave') {
    if (s.Readings.model?.Value) {
      model = s.Readings.model.Value;
    }
    serial = type + '.' + (s.Internals.DEF as string).replace(/ /, '-');
  } else if (type === 'HMCCUDEV' || type === 'HMCCUCHN') {
    model = s.Internals.ccutype;
    serial = s.Internals.DEF;
  }

  if (!serial) {
    serial = fuuid;
  }

  // the SerialNumber mapping only carries the serial number, it is not a reading
  const given = mappings.SerialNumber as Mapping | undefined;
  if (given?.serial != null) {
    serial = given.serial;
  } else if (given?.value != null) {
    serial = given.value;
  } else if (serial && remembered) {
    // what the device was first published with wins over what was worked out now
    serial = remembered(serial);
  }

  return {
    name: sanitizeHapName(s.Internals.NAME),
    fuuid: fuuid,
    alias: alias,
    siriName: s.Attributes.siriName ? s.Attributes.siriName : alias,
    device: s.Internals.NAME,
    type: type,
    model: model,
    PossibleSets: s.PossibleSets,
    room: s.Attributes.room,
    serial: serial,
    uuid_base: serial,
  };
}
