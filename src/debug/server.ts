// a small web page that shows what the plugin has cached and who is subscribed to what
import http from 'node:http';
import util from 'node:util';
import type { Logging } from 'homebridge';
import type { ConnectionStatus } from '../fhem/client.ts';
import type { PluginState } from '../state/pluginState.ts';

export interface DebugResponse {
  write(chunk: string): unknown;
  end(chunk: string): unknown;
}

/** text as it can be written into a page: what it says, and nothing the browser would take for markup */
export function escapeHtml(text: unknown): string {
  return String(text).replace(/[&<>"']/g, (character) => '&#' + character.charCodeAt(0) + ';');
}

/**
 * Answers a request to the debug server: `/cached` lists the connections and the cached value
 * of every subscribed reading, `/subscriptions` dumps the subscriptions.
 *
 * Names and values come from fhem and are escaped. Nobody is asked for a password.
 */
export function handleDebugRequest(
  request: { url?: string },
  response: DebugResponse,
  state: PluginState,
  connections: Record<string, ConnectionStatus | undefined>,
): void {
  if (request.url === '/cached') {
    response.write('<a href="/">home</a><br><br>');
    for (const [key, connection] of Object.entries(connections)) {
      response.write(escapeHtml(key) + '<br>');
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
      response.write(escapeHtml(informId) + ': ' + escapeHtml(state.cache.values[informId]) + '<br>');

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
        response.write(
          '&nbsp;&nbsp;' +
            escapeHtml(mapping.characteristic_type) +
            ': ' +
            escapeHtml(value) +
            ' (' +
            typeof value +
            (defined ? '; means ' + escapeHtml(defined) : '') +
            ')<br>',
        );
      }
      response.write('<br>');
    }
    response.end('');
  } else if (request.url === '/subscriptions') {
    response.write('<a href="/">home</a><br><br>');
    response.end('<pre>subscriptions: ' + escapeHtml(util.inspect(state.subscriptions.byInformId, { depth: 5 })) + '</pre>');
  } else {
    response.end('<a href="/cached">cached</a><br><a href="/subscriptions">subscriptions</a>');
  }
}

/** the port of the debug server when the configuration names none, and the one it moves to when that is taken */
export const DEFAULT_DEBUG_PORT = 8282;
export const FALLBACK_DEBUG_PORT = 8283;

/**
 * What the configuration says about the port of the debug server: a port, `off` for false or 0,
 * or undefined for anything else. Without a value it is the default port.
 */
export function debugPortOf(value: unknown): number | 'off' | undefined {
  if (value === undefined || value === null) {
    return DEFAULT_DEBUG_PORT;
  }
  if (value === false || (typeof value === 'string' && value.trim().toLowerCase() === 'false')) {
    return 'off';
  }

  const port = typeof value === 'string' && value.trim() !== '' ? Number(value) : value;
  if (port === 0) {
    return 'off';
  }
  return typeof port === 'number' && Number.isInteger(port) && port > 0 && port < 65536 ? port : undefined;
}

export interface DebugServerOptions {
  port: number;
  /** the address to listen on. all addresses of the machine without one. */
  host?: string;
  /** the port to try once when the first one is taken */
  fallbackPort?: number;
}

/**
 * Starts the debug server. It shows the names and readings of the devices to whoever can reach
 * it, and listens on all addresses unless it is given one.
 */
export function startDebugServer(options: DebugServerOptions, handler: http.RequestListener, log: Pick<Logging, 'info' | 'error'>): http.Server {
  let port = options.port;

  const server = http.createServer((request, response) => {
    response.setHeader('Content-Type', 'text/html; charset=utf-8');
    handler(request, response);
  });

  server.on('error', (e) => {
    log.error('debug server on port ' + port + ': ' + String(e));

    if (options.fallbackPort !== undefined && port !== options.fallbackPort && (e as { code?: string }).code === 'EADDRINUSE') {
      port = options.fallbackPort;
      server.listen(port, options.host);
    }
  });

  server.on('listening', () => {
    log.info('debug server listening on http://' + (options.host ?? '<ip>') + ':' + port);
  });

  server.listen(port, options.host);

  return server;
}
