import * as hap from '@homebridge/hap-nodejs';
import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { afterEach, describe, expect, it } from 'vitest';
import { createLog } from '../../test/support/log.ts';
import { PluginState } from '../state/pluginState.ts';
import { DEFAULT_DEBUG_PORT, FALLBACK_DEBUG_PORT, debugPortOf, escapeHtml, handleDebugRequest, startDebugServer, type DebugServerOptions } from './server.ts';

function page(url: string, state = new PluginState(hap)): string {
  let text = '';
  const response = {
    write: (chunk: string) => {
      text += chunk;
    },
    end: (chunk: string) => {
      text += chunk;
    },
  };
  handleDebugRequest({ url }, response, state, { 'http://fhem:8083/fhem': { connected: true, connects: 1, disconnects: 0, received: 5, received_total: 9 } });
  return text;
}

it('shows the state of the connections and the cached readings that are subscribed to', () => {
  const state = new PluginState(hap);
  state.subscriptions.subscribe({ device: 'lamp', mappings: {} }, 'lamp-state');
  state.cache.set('lamp-state', 'on');
  state.cache.set('other-state', 'off');

  expect(page('/cached', state)).toBe(
    '<a href="/">home</a><br><br>http://fhem:8083/fhem<br>&nbsp;&nbsp;connected: true; connects: 1<br>' +
      '&nbsp;&nbsp;received: 5; received total: 9<br><br>lamp-state: on<br><br>',
  );
});

it('answers every other address with the links to its pages', () => {
  expect(page('/anything')).toContain('<a href="/cached">cached</a>');
});

it('writes names and values of fhem into the page as text', () => {
  const state = new PluginState(hap);
  state.subscriptions.subscribe({ device: 'lamp', mappings: {} }, 'lamp-<b>state</b>');
  state.cache.set('lamp-<b>state</b>', '<script>alert(1)</script> & "more"');

  expect(page('/cached', state)).toContain('lamp-&#60;b&#62;state&#60;/b&#62;: &#60;script&#62;alert(1)&#60;/script&#62; &#38; &#34;more&#34;<br>');
  expect(page('/subscriptions', state)).not.toContain('<b>');
});

it('escapes what a browser takes for markup', () => {
  expect(escapeHtml('<a href="x" title=\'y\'>&</a>')).toBe('&#60;a href=&#34;x&#34; title=&#39;y&#39;&#62;&#38;&#60;/a&#62;');
  expect(escapeHtml(undefined)).toBe('undefined');
  expect(escapeHtml(5)).toBe('5');
});

it.each([
  [undefined, 8282],
  [null, 8282],
  [9000, 9000],
  ['9000', 9000],
  [false, 'off'],
  ['false', 'off'],
  [0, 'off'],
  ['0', 'off'],
  [65536, undefined],
  [80.5, undefined],
  ['', undefined],
  ['abc', undefined],
  [true, undefined],
])('takes %j from the configuration as the port %j', (value, port) => {
  expect(debugPortOf(value)).toBe(port);
});

it('uses the ports 8282 and 8283 unless it is told otherwise', () => {
  expect([DEFAULT_DEBUG_PORT, FALLBACK_DEBUG_PORT]).toEqual([8282, 8283]);
});

describe('the debug server', () => {
  const servers: Server[] = [];

  afterEach(() => {
    for (const server of servers.splice(0)) {
      server.closeAllConnections();
      server.close();
    }
  });

  /** a port nothing listens on */
  async function freePort(): Promise<number> {
    const probe = createServer();
    await new Promise<void>((resolve) => probe.listen(0, resolve));
    const port = (probe.address() as AddressInfo).port;
    await new Promise((resolve) => probe.close(resolve));
    return port;
  }

  function start(options: DebugServerOptions) {
    const log = createLog();
    const server = startDebugServer(options, (_request, response) => response.end('<b>page</b>'), log);
    servers.push(server);
    return { server, log };
  }

  it('listens on all addresses of the machine, on the port it is given', async () => {
    const port = await freePort();

    const { server, log } = start({ port });
    await new Promise((resolve) => server.once('listening', resolve));

    expect(['::', '0.0.0.0']).toContain((server.address() as AddressInfo).address);
    expect((server.address() as AddressInfo).port).toBe(port);
    expect(log.lines).toEqual([`info debug server listening on http://<ip>:${port}`]);
  });

  it('listens on the address it is given only', async () => {
    const port = await freePort();

    const { server, log } = start({ port, host: '127.0.0.1' });
    await new Promise((resolve) => server.once('listening', resolve));

    expect(server.address()).toMatchObject({ address: '127.0.0.1', port });
    expect(log.lines).toEqual([`info debug server listening on http://127.0.0.1:${port}`]);
  });

  it('serves its pages as html', async () => {
    const port = await freePort();
    const { server } = start({ port, host: '127.0.0.1' });
    await new Promise((resolve) => server.once('listening', resolve));

    const response = await fetch(`http://127.0.0.1:${port}/`);

    expect(response.headers.get('content-type')).toBe('text/html; charset=utf-8');
    expect(await response.text()).toBe('<b>page</b>');
  });

  it('says so when the port is taken, and leaves it at that without a second port to try', async () => {
    const port = await freePort();
    const first = start({ port, host: '127.0.0.1' });
    await new Promise((resolve) => first.server.once('listening', resolve));

    const second = start({ port, host: '127.0.0.1' });
    await new Promise((resolve) => second.server.once('error', resolve));

    expect(second.log.lines).toHaveLength(1);
    expect(second.log.lines[0]).toMatch(new RegExp(`^error debug server on port ${port}: Error: listen EADDRINUSE`));
    expect(second.server.listening).toBe(false);
  });

  it('moves to the second port when the first one is taken', async () => {
    const port = await freePort();
    const fallbackPort = await freePort();
    const first = start({ port, host: '127.0.0.1' });
    await new Promise((resolve) => first.server.once('listening', resolve));

    const second = start({ port, host: '127.0.0.1', fallbackPort });
    await new Promise((resolve) => second.server.once('listening', resolve));

    expect(second.server.address()).toMatchObject({ address: '127.0.0.1', port: fallbackPort });
    expect(second.log.lines).toHaveLength(2);
    expect(second.log.lines[0]).toMatch(new RegExp(`^error debug server on port ${port}: Error: listen EADDRINUSE`));
    expect(second.log.lines[1]).toBe(`info debug server listening on http://127.0.0.1:${fallbackPort}`);
  });

  it('gives up when the second port is taken as well', async () => {
    const port = await freePort();
    const fallbackPort = await freePort();
    const first = start({ port, host: '127.0.0.1' });
    const other = start({ port: fallbackPort, host: '127.0.0.1' });
    await Promise.all([first, other].map(({ server }) => new Promise((resolve) => server.once('listening', resolve))));

    const third = start({ port, host: '127.0.0.1', fallbackPort });
    await new Promise<void>((resolve) => {
      third.server.on('error', () => {
        if (third.log.lines.length === 2) {
          resolve();
        }
      });
    });

    expect(third.log.lines[1]).toMatch(new RegExp(`^error debug server on port ${fallbackPort}: Error: listen EADDRINUSE`));
    expect(third.server.listening).toBe(false);
  });
});
