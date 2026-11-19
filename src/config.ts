// the configuration of a FHEM platform in the config.json of homebridge
import { createRequire } from 'node:module';
import type { Logging, PlatformConfig } from 'homebridge';
import type { HttpAuth } from './fhem/http.ts';

const require = createRequire(import.meta.url);

export interface FhemPlatformConfig extends PlatformConfig {
  /** host name or address of fhem. the platform does nothing without it. */
  server?: string;
  /** the port of FHEMWEB, 8083 if not given */
  port?: number | string;
  /** the fhem devspec that selects the devices to publish, e.g. `room=HomeKit`. all devices if not given. */
  filter?: string;
  /** talk https to FHEMWEB. has to be true or false. */
  ssl?: boolean;
  /** the webname of the FHEMWEB instance, `fhem` if not given */
  webname?: string;
  /** user and password of FHEMWEB */
  auth?: HttpAuth;
  /** a file with functions that mappings can name, absolute or relative to the storage directory of homebridge */
  jsFunctions?: string;
  /** the scopes this platform serves, separated by commas. devices are published unless a scope is given that is not `siri`. */
  scope?: unknown;
  /** keep trying to reach fhem for ever instead of giving up after the fourth failed attempt */
  neverTimeout?: boolean;
}

/**
 * The url of FHEMWEB for the configuration.
 *
 * Ends the homebridge process when `ssl` is neither true nor false.
 */
export function baseUrl(config: FhemPlatformConfig, log: Logging): string {
  let base_url = 'http://';
  if (config.ssl) {
    if (typeof config.ssl !== 'boolean') {
      log.error('config: value for ssl has to be boolean.');
      process.exit(0);
    }
    base_url = 'https://';
  }
  base_url += config.server + ':' + (config.port || 8083);

  if (config.webname) {
    base_url += '/' + config.webname;
  } else {
    base_url += '/fhem';
  }

  return base_url;
}

/** loads the jsFunctions file. answers undefined, after logging why, if it can not be loaded. */
export function loadJsFunctions(file: string, storagePath: string, log: Logging): unknown {
  try {
    let path = file;
    if (!path.startsWith('/')) {
      path = storagePath + '/' + file;
    }
    return require(path);
  } catch (err) {
    log.error('  jsFunctions: ' + String(err));
    return undefined;
  }
}
