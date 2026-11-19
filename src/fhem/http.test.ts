import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { gzipSync } from 'node:zlib';
import { afterEach, describe, expect, it } from 'vitest';
import { get, getText, type GetOptions, type HttpResponse } from './http.ts';

let server: Server | undefined;

afterEach(() => {
  server?.closeAllConnections();
  server?.close();
  server = undefined;
});

function serve(handler: Parameters<typeof createServer>[1]): Promise<string> {
  server = createServer(handler);
  return new Promise((resolve) => {
    server?.listen(0, '127.0.0.1', () => {
      resolve(`http://127.0.0.1:${(server?.address() as AddressInfo).port}/`);
    });
  });
}

function text(url: string, options: GetOptions = {}): Promise<{ error?: Error; response?: HttpResponse; body?: string }> {
  return new Promise((resolve) => {
    getText(url, options, (error, response, body) => {
      resolve({ error, response, body });
    });
  });
}

describe('getText', () => {
  it('hands over the status and the whole body', async () => {
    const url = await serve((_request, response) => {
      response.writeHead(404, 'Nope');
      response.write('a');
      response.end('b');
    });

    const { error, response, body } = await text(url);

    expect(error).toBeUndefined();
    expect(response).toMatchObject({ statusCode: 404, statusMessage: 'Nope' });
    expect(body).toBe('ab');
  });

  it('unpacks a compressed answer it asked for', async () => {
    let accepted: string | undefined;
    const url = await serve((request, response) => {
      accepted = request.headers['accept-encoding'];
      response.writeHead(200, { 'Content-Encoding': 'gzip' }).end(gzipSync('küche'));
    });

    expect((await text(url, { gzip: true })).body).toBe('küche');
    expect(accepted).toBe('gzip');
  });

  it('sends user and password as basic authentication', async () => {
    let authorization: string | undefined;
    const url = await serve((request, response) => {
      authorization = request.headers.authorization;
      response.end();
    });

    await text(url, { auth: { user: 'fhem', pass: 'geheim' } });

    expect(authorization).toBe('Basic ' + Buffer.from('fhem:geheim').toString('base64'));
  });

  it('reports a server that can not be reached', async () => {
    const url = await serve((_request, response) => response.end());
    server?.close();

    const { error, response } = await text(url);

    expect(error).toBeInstanceOf(Error);
    expect(response).toBeUndefined();
  });

  it('reports an address that is no url', async () => {
    expect((await text('http://[')).error).toBeInstanceOf(Error);
  });
});

describe('get', () => {
  it('reports the pieces of the body as they arrive', async () => {
    const url = await serve((_request, response) => {
      response.write('one\n');
      setTimeout(() => response.end('two\n'), 20);
    });

    const events: string[] = [];
    await new Promise<void>((resolve) => {
      get(url, {}, {
        onResponse: (response) => events.push(`response ${response.statusCode}`),
        onData: (chunk) => events.push(`data ${chunk.toString().trim()}`),
        onEnd: () => {
          events.push('end');
          resolve();
        },
      });
    });

    expect(events).toEqual(['response 200', 'data one', 'data two', 'end']);
  });

  it('reports a connection that breaks as an error and not as the end', async () => {
    const url = await serve((_request, response) => {
      response.write('one\n');
      setTimeout(() => response.destroy(), 20);
    });

    const events: string[] = [];
    await new Promise<void>((resolve) => {
      get(url, {}, {
        onEnd: () => {
          events.push('end');
          resolve();
        },
        onError: () => {
          events.push('error');
          resolve();
        },
      });
    });

    expect(events).toEqual(['error']);
  });
});
