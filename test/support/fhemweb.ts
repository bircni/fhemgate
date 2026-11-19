// a stand-in for FHEMWEB, the web server of fhem the plugin talks to. it speaks just enough
// of the protocol: the long poll stream of events, and commands sent as ?cmd=.
import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http';
import type { AddressInfo, Socket } from 'node:net';
import type { FhemDevice } from './types.ts';

export interface FakeFhemOptions {
  /** the token FHEMWEB hands out and wants back with every command. undefined for a FHEMWEB without one. */
  csrfToken?: string;
  /** what `jsonlist2` answers, whatever the filter */
  devices?: FhemDevice[];
  /** the value of the userattr attribute of global */
  userattr?: string;
  /** readings by 'device reading' for ReadingsVal */
  readings?: Record<string, string>;
  /** user and password, if FHEMWEB asks for them */
  auth?: { user: string; pass: string };
  /** answers a command before any of the built in answers are tried */
  answer?: (cmd: string) => { status?: number; body: string } | undefined;
}

export interface FakeFhem {
  port: number;
  options: FakeFhemOptions;
  /** the commands received, decoded */
  commands: string[];
  /** every request: the raw url and the authorization header */
  requests: { url: string; authorization: string | undefined }[];
  /** the urls of the long poll requests */
  streams: string[];
  /** sends raw text down every open event stream */
  send(text: string): void;
  /** sends one event in the JSON format the plugin asks for */
  event(informId: string, value: string): void;
  /** ends the open event streams, as FHEMWEB does when fhem restarts */
  endStreams(): void;
  /** number of event streams that are open */
  openStreams(): number;
  close(): Promise<void>;
}

export async function startFakeFhem(options: FakeFhemOptions = {}): Promise<FakeFhem> {
  const sockets = new Set<Socket>();
  const open = new Set<ServerResponse>();

  const fhem: FakeFhem = {
    port: 0,
    options: { csrfToken: 'csrf_fake_token', userattr: 'genericDeviceType:switch,light homebridgeMapping:textField-long siriName', ...options },
    commands: [],
    requests: [],
    streams: [],
    send(text) {
      for (const response of open) {
        response.write(text);
      }
    },
    event(informId, value) {
      fhem.send(`${JSON.stringify([informId, value, `<div>${value}</div>`])}\n`);
    },
    endStreams() {
      for (const response of open) {
        response.end();
      }
      open.clear();
    },
    openStreams: () => open.size,
    close() {
      for (const socket of sockets) {
        socket.destroy();
      }
      return new Promise((resolve) => server.close(() => {
        resolve();
      }));
    },
  };

  function answer(cmd: string): { status?: number; body: string } {
    const custom = fhem.options.answer?.(cmd);
    if (custom) {
      return custom;
    }

    if (cmd.startsWith('jsonlist2')) {
      const devices = cmd.includes('TYPE=siri') ? [] : fhem.options.devices ?? [];
      return { body: JSON.stringify({ Arg: cmd.slice(10), Results: devices, totalResultsReturned: devices.length }) };
    }
    if (cmd === '{AttrVal("global","userattr","")}') {
      return { body: `${fhem.options.userattr ?? ''}\n` };
    }
    const reading = /^\{ReadingsVal\("(.*)","(.*)",""\)\}$/.exec(cmd);
    if (reading) {
      return { body: `${fhem.options.readings?.[`${reading[1]} ${reading[2]}`] ?? ''}\n` };
    }
    return { body: '\n' };
  }

  function handle(request: IncomingMessage, response: ServerResponse): void {
    const url = request.url ?? '';
    fhem.requests.push({ url, authorization: request.headers.authorization });

    const { auth, csrfToken } = fhem.options;
    if (auth && request.headers.authorization !== `Basic ${Buffer.from(`${auth.user}:${auth.pass}`).toString('base64')}`) {
      response.writeHead(401, { 'WWW-Authenticate': 'Basic realm="fhem"' }).end();
      return;
    }

    if (csrfToken !== undefined) {
      response.setHeader('X-FHEM-csrfToken', csrfToken);
    }

    const query = url.slice(url.indexOf('?') + 1);
    if (query.includes('inform=')) {
      fhem.streams.push(url);
      response.writeHead(200, { 'Content-Type': 'application/octet-stream' });
      response.flushHeaders();
      open.add(response);
      response.on('close', () => open.delete(response));
      return;
    }

    // the plugin builds the query by hand, so it is taken apart by hand as well
    const parameters = query.split('&');
    const cmd = decodeURIComponent((parameters.find((parameter) => parameter.startsWith('cmd=')) ?? 'cmd=').slice(4));
    fhem.commands.push(cmd);

    const token = parameters.find((parameter) => parameter.startsWith('fwcsrf='))?.slice(7);
    if (csrfToken !== undefined && token !== csrfToken) {
      response.writeHead(400, 'Bad Request').end();
      return;
    }

    const { status = 200, body } = answer(cmd);
    response.writeHead(status, { 'Content-Type': 'text/plain; charset=utf-8' }).end(body);
  }

  const server: Server = createServer(handle);
  server.on('connection', (socket) => {
    sockets.add(socket);
    socket.on('close', () => sockets.delete(socket));
  });

  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  fhem.port = (server.address() as AddressInfo).port;
  return fhem;
}

/** waits until the condition holds. setImmediate is used so that it also works while timers are faked. */
export async function waitFor(condition: () => boolean, what = 'the condition', milliseconds = 3000): Promise<void> {
  const deadline = performance.now() + milliseconds;
  while (!condition()) {
    if (performance.now() > deadline) {
      throw new Error(`timed out waiting for ${what}`);
    }
    await new Promise((resolve) => setImmediate(resolve));
  }
}
