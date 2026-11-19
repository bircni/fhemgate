// the long poll: one request to fhem that stays open and carries every event as a line
import type { PluginState } from '../state/pluginState.ts';
import { ct2rgb, rgb2hsv, xyY2rgb, type Hsv } from '../util/color.ts';
import { describeError, isCertificateError, requestOptions, type ConnectionStatus, type FhemConnection } from './client.ts';
import { get, getText, type GetRequest, type HttpResponse } from './http.ts';
import { commandUrl, longpollUrl, parseEventLine, reconnectDelayAfterEnd, retryDelayAfterError } from './protocol.ts';

/**
 * Milliseconds without a single byte from fhem after which the long poll is looked at. fhem
 * sends every event of every device down the long poll, so on most installations something
 * arrives every few seconds. A connection that died without either side being told, as after a
 * router restart or behind a proxy, looks exactly like a quiet fhem: nothing arrives.
 */
export const LONGPOLL_IDLE_TIMEOUT = 15 * 60 * 1000;

/**
 * A fhem that really is quiet answers the check, and its long poll is opened again without need.
 * That is harmless but pointless, so the wait doubles each time nothing arrived in between, up
 * to this many milliseconds, and starts over with the first byte that arrives.
 */
export const LONGPOLL_IDLE_TIMEOUT_MAX = 4 * 60 * 60 * 1000;

/** milliseconds fhem has to answer the check of a silent long poll */
export const LONGPOLL_PROBE_TIMEOUT = 10 * 1000;

/**
 * Milliseconds of silence after which the operating system starts to probe the connection of the
 * long poll. It ends the connection with an error when the other side does not answer the probes.
 */
const LONGPOLL_KEEPALIVE = 60 * 1000;

/** how long nothing may arrive before the long poll is checked, after it was opened again that many times in a row for being silent */
export function idleTimeout(reopened: number): number {
  return Math.min(LONGPOLL_IDLE_TIMEOUT * 2 ** reopened, LONGPOLL_IDLE_TIMEOUT_MAX);
}

/**
 * Opens the long poll to the fhem of the connection, unless there is one already, and keeps it
 * open: when it ends or fails it is opened again after a pause that grows with every attempt.
 * A fhem that was never reached is given up after the fourth failure, unless the connection
 * says never to. A fhem that refuses user and password, or whose certificate is not accepted,
 * is tried again for as long as that is so.
 *
 * A long poll nothing arrives on is checked: see watchSilence below.
 *
 * @param onConnected called every time FHEMWEB has answered the request
 */
export function startLongpoll(state: PluginState, connection: FhemConnection, onConnected: () => void): void {
  const status: ConnectionStatus = (state.longpoll[connection.base_url] ??= { connects: 0, disconnects: 0, received_total: 0 });

  if (status.connected) {
    return;
  }
  status.connects++;
  status.received = 0;
  status.connected = true;

  const url = longpollUrl(connection.base_url, status.last_event_time, Date.now());
  console.log('starting longpoll: ' + url);

  let offset = 0;
  let input = '';
  const decoder = new TextDecoder();

  /** takes one line of the stream to the characteristics that are subscribed to its reading */
  const handleLine = (line: string, lastEventTime: number): void => {
    const event = parseEventLine(line);
    if (!event) {
      return;
    }

    const subscriptions = state.subscriptions.byInformId[event.informId];
    if (!subscriptions) {
      return;
    }

    state.update(event.informId, event.value);
    status.last_event_time = lastEventTime;

    subscriptions.forEach((subscription) => {
      // a light that takes its colour as xy or colour temperature reports no hue and
      // saturation for it. they are worked out here for the mappings that read them.
      if (subscription.accessory.mappings.colormode) {
        let hsv: Hsv;
        if (event.reading === 'xy') {
          const xy = event.value.split(',');
          hsv = rgb2hsv(xyY2rgb(xy[0] as string, xy[1] as string, 1)) as Hsv;
        } else if (event.reading === 'ct') {
          hsv = rgb2hsv(ct2rgb(event.value)) as Hsv;
        } else {
          return;
        }

        state.update(event.device + '-h', hsv[0]);
        state.update(event.device + '-s', hsv[1]);
        state.update(event.device + '-v', hsv[2]);

        state.update(event.device + '-' + event.reading, event.value, false);
      }
    });
  };

  // set when FHEMWEB answers that user and password are missing or wrong
  let refused: HttpResponse | undefined;

  let silence: ReturnType<typeof setTimeout> | undefined;

  /** the long poll failed: it is tried again after a pause, or given up if fhem was never reached */
  const failed = (err: Error): void => {
    clearTimeout(silence);
    status.connected = false;

    status.disconnects++;
    const timeout = retryDelayAfterError(status.disconnects);

    // a certificate that is not accepted is no reason to give up: the platform would hand
    // homebridge no accessories, and HomeKit would forget the ones it has
    if (!connection.neverTimeout && timeout > 10000 && !state.csrfToken[connection.base_url] && !isCertificateError(err)) {
      connection.log.error('longpoll error: ' + describeError(err) + ', retrys exhausted');
      connection.dead = true;
      return;
    }

    connection.log.error('longpoll error: ' + describeError(err) + ', retry in: ' + timeout + 'msec');
    setTimeout(() => {
      startLongpoll(state, connection, onConnected);
    }, timeout);
  };

  /**
   * Starts the wait for the next byte over. When nothing arrives for too long, the connection
   * may be dead without anybody having been told. fhem is then asked something that costs it
   * nothing. If it answers, it is there and the silent long poll is replaced by a new one, which
   * asks for the events since the last one that arrived. If it does not answer, the long poll is
   * taken for failed and tried again like after any other failure.
   */
  const watchSilence = (): void => {
    clearTimeout(silence);
    const milliseconds = idleTimeout(status.reopened_silent ?? 0);
    silence = setTimeout(() => {
      const minutes = Math.round(milliseconds / 60000);
      connection.log.debug('longpoll: nothing arrived for ' + minutes + ' minutes, asking fhem if it is there');

      const probe = commandUrl(connection.base_url, '{1}', state.csrfToken[connection.base_url]);
      getText(probe, { ...requestOptions(connection), timeout: LONGPOLL_PROBE_TIMEOUT }, (err, response) => {
        if (!status.connected || request !== current.get(status)) {
          // the long poll ended or was replaced while fhem was asked
          return;
        }

        request.abort();
        if (err) {
          failed(new Error('nothing arrived for ' + minutes + ' minutes and fhem does not answer (' + describeError(err) + ')'));
          return;
        }
        if (response?.statusCode !== 200) {
          failed(new Error('nothing arrived for ' + minutes + ' minutes and fhem answers ' + response?.statusCode + ' ' + response?.statusMessage));
          return;
        }

        connection.log.info('longpoll: nothing arrived for ' + minutes + ' minutes while fhem answers. opening the long poll again.');
        status.reopened_silent = (status.reopened_silent ?? 0) + 1;
        status.connected = false;
        startLongpoll(state, connection, onConnected);
      });
    }, milliseconds);
    // homebridge is not kept from ending by this wait
    silence.unref();
  };

  const request = get(
    url,
    { ...requestOptions(connection), keepAlive: LONGPOLL_KEEPALIVE },
    {
      onData: (data) => {
        if (refused) {
          // the text of the refusal, no events
          return;
        }

        status.reopened_silent = 0;
        watchSilence();

        const length = data.length;
        status.received = (status.received ?? 0) + length;
        status.received_total += length;

        input += decoder.decode(data, { stream: true });

        const lastEventTime = Date.now();
        for (;;) {
          const nOff = input.indexOf('\n', offset);
          if (nOff < 0) {
            break;
          }
          const l = input.substring(offset, nOff);
          offset = nOff + 1;

          if (!l.length) {
            continue;
          }

          // a line that can not be handled is reported and the lines after it are still looked at
          try {
            handleLine(l, lastEventTime);
          } catch (err) {
            connection.log.error('  error in longpoll connection: ' + String(err));
          }
        }

        input = input.substring(offset);
        offset = 0;

        if (state.csrfToken[connection.base_url]) {
          status.disconnects = 0;
        }
      },

      onResponse: (response) => {
        if (response.statusCode === 401 || response.statusCode === 403) {
          refused = response;
          return;
        }

        const token = response.headers['x-fhem-csrftoken'];
        state.csrfToken[connection.base_url] = token ? String(token) : '';

        watchSilence();
        onConnected();
      },

      onEnd: () => {
        clearTimeout(silence);
        status.connected = false;

        status.disconnects++;

        if (refused) {
          // trying again at once does not help. the pause grows as after a failure, and it is
          // tried for as long as homebridge runs: the password may be corrected in fhem.
          const timeout = retryDelayAfterError(status.disconnects);
          connection.log.error(
            'longpoll refused by fhem with ' +
              refused.statusCode +
              ' ' +
              refused.statusMessage +
              ': authentication failed. check user and password (auth) of the platform. retry in: ' +
              timeout +
              'msec',
          );
          setTimeout(() => {
            startLongpoll(state, connection, onConnected);
          }, timeout);
          return;
        }

        const timeout = reconnectDelayAfterEnd(status.disconnects);

        connection.log.error('longpoll ended, reconnect in: ' + timeout + 'msec');
        setTimeout(() => {
          startLongpoll(state, connection, onConnected);
        }, timeout);
      },

      onError: failed,
    },
  );
  current.set(status, request);
}

// the request of the long poll that is open for each fhem, by the status of its connection
const current = new WeakMap<ConnectionStatus, GetRequest>();
