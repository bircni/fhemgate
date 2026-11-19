// the connection to one fhem and the commands that are sent over it
import type { Logging } from 'homebridge';
import type { Jsonlist2Device } from '../devices/types.ts';
import type { PluginState } from '../state/pluginState.ts';
import { getText, type GetOptions, type HttpAuth, type HttpResponse } from './http.ts';
import { commandUrl, devicesUrl } from './protocol.ts';

/** where one fhem is reached and how */
export interface FhemConnection {
  /** the url of FHEMWEB: `http[s]://<server>:<port>/<webname>` */
  base_url: string;
  log: Logging;
  /** user and password for FHEMWEB */
  auth?: HttpAuth;
  /** keep trying to open the long poll for ever */
  neverTimeout?: boolean;
  /** set when the long poll was given up without ever reaching fhem */
  dead?: boolean;
}

/** how the long poll to one fhem is doing */
export interface ConnectionStatus {
  connected?: boolean;
  connects: number;
  /** how often in a row the long poll ended or failed */
  disconnects: number;
  /** bytes received on the current connection, and since homebridge started */
  received?: number;
  received_total: number;
  /** when the last event for a subscribed reading arrived, in milliseconds since the epoch */
  last_event_time?: number;
}

/** what jsonlist2 answers */
export interface DeviceList {
  Results: Jsonlist2Device[];
  totalResultsReturned: number;
}

/**
 * The certificate of the server is not checked when user and password are configured.
 * That is how it was in homebridge-fhem and is listed in docs/KNOWN_BUGS.md.
 */
export function requestOptions(connection: FhemConnection): GetOptions {
  return connection.auth ? { auth: connection.auth, insecure: true } : {};
}

/**
 * Runs a command in fhem. The callback gets the answer without line breaks. It is not called
 * when fhem can not be reached or refuses the command, which is only logged.
 */
export function execute(state: PluginState, log: Logging, connection: FhemConnection, cmd: string, callback?: (result: string) => void): void {
  const url = commandUrl(connection.base_url, cmd, state.csrfToken[connection.base_url]);
  // the url carries the csrf token into the log. see docs/KNOWN_BUGS.md, 24.
  log.info('  executing: ' + url);

  getText(url, { ...requestOptions(connection), gzip: true }, (err, response, result) => {
    if (!err && response?.statusCode === 200) {
      if (callback) {
        callback((result as string).replace(/[\r\n]/g, ''));
      }
    } else {
      log('There was a problem connecting to FHEM (' + url + ').');
      if (response) {
        log('  ' + response.statusCode + ': ' + response.statusMessage);
      }
    }

    if (err) {
      log('There was a problem connecting to FHEM (' + url + '):' + describeError(err));
    }
  });
}

/**
 * Asks fhem for the devices of the filter. The callback gets the response and what fhem
 * answered: the list of devices, or the text if it was no JSON.
 */
export function fetchDevices(
  state: PluginState, log: Logging, connection: FhemConnection, filter: string | undefined,
  callback: (error: Error | undefined, response?: HttpResponse, devices?: DeviceList) => void,
): void {
  const url = devicesUrl(connection.base_url, filter, state.csrfToken[connection.base_url]);
  log.info('fetching: ' + url);

  getText(url, { ...requestOptions(connection), gzip: true }, (err, response, body) => {
    let devices: unknown = body;
    try {
      devices = JSON.parse(body as string);
    } catch {
      // handed on as text
    }
    callback(err, response, devices as DeviceList | undefined);
  });
}

/** an error as text, with the reason Node gives for a failed connection */
export function describeError(error: Error): string {
  const errors = (error as AggregateError).errors as Error[] | undefined;
  return String(errors?.length && !error.message ? errors[0] : error);
}
