// what homebridge-fhem 0.5.55 made the identity of an accessory from, written down from its
// index.js (https://github.com/justme-1968/homebridge-fhem, branch master, commit 80d5cc6) so that
// the tests can hold this plugin against it. Nothing here uses the code under test.
//
// The lines named are those of that index.js. Keep this as it is there, also where it could be
// written shorter: it is the record of what the installations that move to this plugin had.
// Only the comparisons are written with === and !== where index.js has == and !=, which is the
// same for the text and the missing values compared here.
import * as hap from '@homebridge/hap-nodejs';
import type { FhemDevice } from './types.ts';

/** index.js 1262-1266: `sanitizeHapName` */
function sanitizeHapName(name: string | number | null | undefined): string {
  let text = name === undefined || name === null ? '' : String(name);
  text = text.replace(/[_]/g, '-');
  return text || 'FHEM Device';
}

export interface UpstreamIdentity {
  /** `this.name`, which homebridge takes as the name of the accessory */
  name: string;
  /** `this.serial`, shown as the serial number */
  serial: string | undefined;
  /** `this.uuid_base`, which homebridge makes the uuid of the accessory from */
  uuid_base: string | undefined;
  /** `this.displayName`, which fakegato-history names its file after */
  displayName: string | undefined;
}

/**
 * index.js 2026-2080, the part of the constructor of `FHEMAccessory` that sets `name`, `serial`
 * and `uuid_base`, and 2914 in `getServices`, which sets `displayName`.
 *
 * @param serialNumberMapping `this.mappings.SerialNumber`: what the homebridgeMapping attribute
 * says for SerialNumber, if anything
 */
export function upstreamIdentity(s: FhemDevice, serialNumberMapping?: { serial?: string; value?: string }): UpstreamIdentity {
  const type = s.Internals.TYPE; // 2031
  const fuuid = s.Internals.FUUID; // 2027
  let serial: string | undefined;

  if (type === 'CUL_HM') {
    // 2038-2043
    serial = type + '.' + s.Internals.DEF;
    if (s.Attributes.serialNr) {
      serial = s.Attributes.serialNr;
    } else if (s.Readings['D-serialNr'] && s.Readings['D-serialNr'].Value) {
      serial = s.Readings['D-serialNr'].Value;
    }
  } else if (type === 'CUL_WS' || type === 'Siro' || type === 'FS20' || type === 'IT' || type === 'EnOcean') {
    // 2044-2045
    serial = type + '.' + s.Internals.DEF;
  } else if (type === 'HUEDevice') {
    // 2046-2048
    if (s.Internals.uniqueid && s.Internals.uniqueid !== 'ff:ff:ff:ff:ff:ff:ff:ff-0b') {
      serial = s.Internals.uniqueid;
    }
  } else if (type === 'SONOSPLAYER') {
    // 2049-2050
    serial = s.Internals.UDN;
  } else if (type === 'WOL') {
    // 2051-2052
    serial = type + '.' + s.Internals.MAC;
  } else if (type === 'MAX') {
    // 2053-2055
    serial = type + '.' + s.Internals.addr;
  } else if (type === 'DUOFERN') {
    // 2056-2058
    serial = type + '.' + s.Internals.DEF;
  } else if (type === 'ZWave') {
    // 2059-2062
    serial = type + '.' + (s.Internals.DEF as string).replace(/ /, '-');
  } else if (type === 'HMCCUDEV' || type === 'HMCCUCHN') {
    // 2063-2065
    serial = s.Internals.DEF;
  }

  // 2068-2069
  if (!serial) {
    serial = fuuid;
  }

  // 2072-2077
  if (serialNumberMapping !== undefined) {
    if (serialNumberMapping.serial !== undefined) {
      serial = serialNumberMapping.serial;
    } else if (serialNumberMapping.value !== undefined) {
      serial = serialNumberMapping.value;
    }
  }

  return {
    name: sanitizeHapName(s.Internals.NAME), // 2026
    serial,
    uuid_base: serial, // 2080
    displayName: fuuid, // 2914
  };
}

/**
 * The uuid homebridge gives the accessory of a static platform: `createHAPAccessory` in its
 * bridgeService generates it from the `platform` of the config entry, a colon, and the
 * `uuid_base` of the accessory or else its name. The plugin that registered the platform is no
 * part of it. homebridge-fhem and this plugin both leave it to homebridge.
 *
 * @param platform what the config entry says for `platform`
 */
export function homebridgeUuid(identity: { name?: string; uuid_base?: string }, platform = 'FHEM'): string {
  return hap.uuid.generate(`${platform}:${identity.uuid_base || identity.name}`);
}
