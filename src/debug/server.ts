// a small web page that shows what the plugin has cached and who is subscribed to what
import http from 'node:http';
import util from 'node:util';
import type { PluginState } from '../state/pluginState.ts';

/** how the long poll to one fhem is doing */
export interface ConnectionStatus {
  connected?: boolean;
  connects: number;
  disconnects: number;
  /** bytes received on the current connection, and since homebridge started */
  received?: number;
  received_total: number;
  /** when the last event for a subscribed reading arrived, in milliseconds since the epoch */
  last_event_time?: number;
}

export interface DebugResponse {
  write(chunk: string): unknown;
  end(chunk: string): unknown;
}

/**
 * Answers a request to the debug server: `/cached` lists the connections and the cached value
 * of every subscribed reading, `/subscriptions` dumps the subscriptions.
 *
 * Nothing is escaped and nobody is asked for a password. See docs/KNOWN_BUGS.md, 30.
 */
export function handleDebugRequest(
  request: { url?: string }, response: DebugResponse, state: PluginState, connections: Record<string, ConnectionStatus | undefined>,
): void {
  if (request.url === '/cached') {
    response.write('<a href="/">home</a><br><br>');
    for (const [key, connection] of Object.entries(connections)) {
      response.write(key + '<br>');
      response.write('&nbsp;&nbsp;connected: ' + connection?.connected);
      response.write('; connects: ' + connection?.connects + '<br>');
      response.write('&nbsp;&nbsp;received: ' + connection?.received);
      response.write('; received total: ' + connection?.received_total + '<br>');
      if (connection?.last_event_time) {
        response.write('&nbsp;&nbsp;last event: ' + String(new Date(connection.last_event_time)) + '<br>');
      }
    }
    response.write('<br>');

    for (const [informId, subscriptions] of Object.entries(state.subscriptions.byInformId)) {
       
      response.write(informId + ': ' + String(state.cache.values[informId]) + '<br>');

      for (const subscription of subscriptions ?? []) {
        const mapping = subscription.characteristic?.FHEM_mapping;
        if (mapping?.cached === undefined) {
          continue;
        }

        const value = mapping.cached;

        let defined: string | undefined = undefined;
        if (mapping.homekit2name !== undefined) {
          defined = mapping.homekit2name[value as unknown as string];
          if (defined === undefined) {
            defined = '???';
          }
        }
        response.write('&nbsp;&nbsp;' + mapping.characteristic_type + ': ' + value + ' (' + typeof (value) + (defined ? '; means ' + defined : '') + ')<br>');
      }
      response.write('<br>');
    }
    response.end('');
  } else if (request.url === '/subscriptions') {
    response.write('<a href="/">home</a><br><br>');
    response.end('<pre>subscriptions: ' + util.inspect(state.subscriptions.byInformId, { depth: 5 }) + '</pre>');
  } else {
    response.end('<a href="/cached">cached</a><br><a href="/subscriptions">subscriptions</a>');
  }
}

/** listens on port 8282 on all interfaces, or on 8283 if that port is taken */
export function startDebugServer(handler: http.RequestListener): http.Server {
  let port = 8282;

  const server = http.createServer(handler);

  server.on('error', (e) => {
    console.log('Server error: ' + String(e));

    if (port === 8282) {
      port = 8283;
      server.close();
      server.listen(port);
    }
  });

  server.listen(port, () => {
    console.log('Server listening on: http://<ip>:%s', port);
  });

  return server;
}
