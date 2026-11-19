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
  /** talk https to FHEMWEB. meant to be true or false. */
  ssl?: boolean;
  /** the webname of the FHEMWEB instance, `fhem` if not given */
  webname?: string;
  /** user and password of FHEMWEB */
  auth?: HttpAuth;
  /** a file with functions that mappings can name, absolute or relative to the storage directory of homebridge */
  jsFunctions?: string;
  /** the scopes this platform serves, separated by commas or as a list. devices are published unless scopes are given and `siri` is not one of them. */
  scope?: unknown;
  /** keep trying to reach fhem for ever instead of giving up after the fourth failed attempt */
  neverTimeout?: boolean;
  /**
   * The port of a web page that shows what the plugin has cached and who is subscribed to what.
   * 8282 if not given, or 8283 when that is taken. There is no such page with false or 0.
   */
  debugPort?: number | false;
  /** the address the debug page is served on, e.g. `127.0.0.1` for this machine only. all addresses of the machine if not given. */
  debugHost?: string;
}

/**
 * Whether the configuration asks for https. `ssl` is meant to be true or false. Text that says
 * true is taken for it with a warning, anything else that is no boolean counts as false.
 */
function wantsSsl(ssl: unknown, log: Logging): boolean {
  if (typeof ssl === 'boolean' || !ssl) {
    return Boolean(ssl);
  }

  const text = (typeof ssl === 'string' ? ssl : JSON.stringify(ssl)).trim().toLowerCase();
  if (text === 'true' || text === '1') {
    log.warn('config: value for ssl has to be boolean. taking ' + JSON.stringify(ssl) + ' as true.');
    return true;
  }

  log.error('config: value for ssl has to be boolean. taking ' + JSON.stringify(ssl) + ' as false.');
  return false;
}

/** the url of FHEMWEB for the configuration */
export function baseUrl(config: FhemPlatformConfig, log: Logging): string {
  let base_url = 'http://';
  if (wantsSsl(config.ssl, log)) {
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
