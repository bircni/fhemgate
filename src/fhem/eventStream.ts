// the long poll: one request to fhem that stays open and carries every event as a line
import type { PluginState } from '../state/pluginState.ts';
import { ct2rgb, rgb2hsv, xyY2rgb, type Hsv } from '../util/color.ts';
import { describeError, requestOptions, type ConnectionStatus, type FhemConnection } from './client.ts';
import { get } from './http.ts';
import { longpollUrl, parseEventLine, reconnectDelayAfterEnd, retryDelayAfterError } from './protocol.ts';

/**
 * Opens the long poll to the fhem of the connection, unless there is one already, and keeps it
 * open: when it ends or fails it is opened again after a pause that grows with every attempt.
 * A fhem that was never reached is given up after the fourth failure, unless the connection
 * says never to.
 *
 * @param onConnected called every time FHEMWEB has answered the request
 */
export function startLongpoll(state: PluginState, connection: FhemConnection, onConnected: () => void): void {
  const status: ConnectionStatus = state.longpoll[connection.base_url] ??= { connects: 0, disconnects: 0, received_total: 0 };

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

  get(url, requestOptions(connection), {
    onData: (data) => {
      const length = data.length;
      status.received = (status.received ?? 0) + length;
      status.received_total += length;

      input += decoder.decode(data, { stream: true });

      // when something fails for one line, the lines that arrived with it and were not looked
      // at yet stay in the buffer until more data arrives. see docs/KNOWN_BUGS.md, 8.
      try {
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

          const event = parseEventLine(l);
          if (!event) {
            continue;
          }

          const subscriptions = state.subscriptions.byInformId[event.informId];
          if (subscriptions) {
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
          }
        }
      } catch (err) {
        connection.log.error('  error in longpoll connection: ' + String(err));
      }

      input = input.substring(offset);
      offset = 0;

      if (state.csrfToken[connection.base_url]) {
        status.disconnects = 0;
      }
    },

    onResponse: (response) => {
      const token = response.headers['x-fhem-csrftoken'];
      state.csrfToken[connection.base_url] = token ? String(token) : '';

      onConnected();
    },

    onEnd: () => {
      status.connected = false;

      status.disconnects++;
      const timeout = reconnectDelayAfterEnd(status.disconnects);

      connection.log.error('longpoll ended, reconnect in: ' + timeout + 'msec');
      setTimeout(() => {
        startLongpoll(state, connection, onConnected);
      }, timeout);
    },

    onError: (err) => {
      status.connected = false;

      status.disconnects++;
      const timeout = retryDelayAfterError(status.disconnects);

      if (!connection.neverTimeout && timeout > 10000 && !state.csrfToken[connection.base_url]) {
        connection.log.error('longpoll error: ' + describeError(err) + ', retrys exhausted');
        connection.dead = true;
        return;
      }

      connection.log.error('longpoll error: ' + describeError(err) + ', retry in: ' + timeout + 'msec');
      setTimeout(() => {
        startLongpoll(state, connection, onConnected);
      }, timeout);
    },
  });
}
