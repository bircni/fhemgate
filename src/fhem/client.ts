// the connection to one fhem and the commands that are sent over it
import type { Logging } from 'homebridge';
import type { Jsonlist2Device } from '../devices/types.ts';
import type { PluginState } from '../state/pluginState.ts';
import { getText, type GetOptions, type HttpAuth, type HttpResponse } from './http.ts';
import { commandUrl, devicesUrl, withoutToken } from './protocol.ts';

/** where one fhem is reached and how */
export interface FhemConnection {
  /** the url of FHEMWEB: `http[s]://<server>:<port>/<webname>` */
  base_url: string;
  log: Logging;
  /** user and password for FHEMWEB */
  auth?: HttpAuth;
  /**
   * Whether the certificate of the server has to be one Node trusts. Without a value it has to
   * unless user and password are configured.
   */
  rejectUnauthorized?: boolean;
}

/** how the long poll to one fhem is doing */
export interface ConnectionStatus {
  /** a long poll is open or being opened */
  connected?: boolean;
  /** FHEMWEB answered the long poll that is open. false while it is being opened, and after it ended or failed. */
  reachable?: boolean;
  connects: number;
  /** how often in a row the long poll ended or failed */
  disconnects: number;
  /** bytes received on the current connection, and since homebridge started */
  received?: number;
  received_total: number;
  /** how often in a row the long poll was opened again because nothing arrived on it while fhem answered */
  reopened_silent?: number;
  /** when the last event for a subscribed reading arrived, in milliseconds since the epoch */
  last_event_time?: number;
}

/** what jsonlist2 answers */
export interface DeviceList {
  Results: Jsonlist2Device[];
  totalResultsReturned: number;
}

/**
 * What every request to the fhem of the connection is sent with.
 *
 * The certificate of the server is checked when the connection says so, and not checked when
 * it says not to. When it says nothing, the certificate is not checked if user and password are
 * configured, and checked if they are not. That is how it was in homebridge-fhem: it sends the
 * password to whoever answers, so a connection with a password should ask for the check.
 */
export function requestOptions(connection: Pick<FhemConnection, 'auth' | 'rejectUnauthorized'>): GetOptions {
  const options: GetOptions = {};
  if (connection.auth) {
    options.auth = connection.auth;
  }
  if (connection.rejectUnauthorized === false || (connection.rejectUnauthorized === undefined && connection.auth)) {
    options.insecure = true;
  }
  return options;
}

/**
 * Runs a command in fhem. The callback gets the answer without line breaks. It is not called
 * when fhem can not be reached or refuses the command, which is only logged.
 */
export function execute(state: PluginState, log: Logging, connection: FhemConnection, cmd: string, callback?: (result: string) => void): void {
  const url = commandUrl(connection.base_url, cmd, state.csrfToken[connection.base_url]);
  const shown = withoutToken(url);
  log.debug('  executing: ' + shown);

  getText(url, { ...requestOptions(connection), gzip: true }, (err, response, result) => {
    if (!err && response?.statusCode === 200) {
      if (callback) {
        callback((result as string).replace(/[\r\n]/g, ''));
      }
    } else {
      log('There was a problem connecting to FHEM (' + shown + ').');
      if (response) {
        log('  ' + response.statusCode + ': ' + response.statusMessage);
      }
    }

    if (err) {
      log('There was a problem connecting to FHEM (' + shown + '):' + describeError(err));
    }
  });
}

/**
 * Asks fhem for the devices of the filter. The callback gets the response and the list of
 * devices, or no list when fhem answered something else.
 */
export function fetchDevices(
  state: PluginState,
  log: Logging,
  connection: FhemConnection,
  filter: string | undefined,
  callback: (error: Error | undefined, response?: HttpResponse, devices?: DeviceList) => void,
): void {
  const url = devicesUrl(connection.base_url, filter, state.csrfToken[connection.base_url]);
  log.info('fetching: ' + withoutToken(url));

  getText(url, { ...requestOptions(connection), gzip: true }, (err, response, body) => {
    callback(err, response, deviceList(body));
  });
}

/** what jsonlist2 answered, if it is a list of devices: no JSON may be an error page, or nothing at all */
export function deviceList(body: string | undefined): DeviceList | undefined {
  try {
    const answer = JSON.parse(body as string) as Partial<DeviceList> | null;
    return Array.isArray(answer?.Results) ? (answer as DeviceList) : undefined;
  } catch {
    return undefined;
  }
}

/** the csrf token FHEMWEB hands out with an answer: empty for a FHEMWEB that has none */
export function csrfTokenOf(response: HttpResponse): string {
  const token = response.headers['x-fhem-csrftoken'];
  return token ? String(token) : '';
}

// the reasons Node gives for a certificate it does not accept
const certificateErrors = new Set([
  'DEPTH_ZERO_SELF_SIGNED_CERT',
  'SELF_SIGNED_CERT_IN_CHAIN',
  'UNABLE_TO_VERIFY_LEAF_SIGNATURE',
  'UNABLE_TO_GET_ISSUER_CERT',
  'UNABLE_TO_GET_ISSUER_CERT_LOCALLY',
  'CERT_UNTRUSTED',
  'CERT_HAS_EXPIRED',
  'CERT_NOT_YET_VALID',
  'ERR_TLS_CERT_ALTNAME_INVALID',
]);

/** whether the connection failed because the certificate of the server was not accepted */
export function isCertificateError(error: Error): boolean {
  return certificateErrors.has(String((error as { code?: unknown }).code));
}

/** an error as text, with the reason Node gives for a failed connection, and what to do about a certificate that was not accepted */
export function describeError(error: Error): string {
  const errors = (error as AggregateError).errors as Error[] | undefined;
  const text = String(errors?.length && !error.message ? errors[0] : error);
  if (isCertificateError(error)) {
    return text + ' (the certificate of fhem is not trusted. make node trust it, or set rejectUnauthorized to false for the platform)';
  }
  return text;
}
