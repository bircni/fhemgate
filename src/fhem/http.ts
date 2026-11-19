// GET requests with the http modules of Node. FHEMWEB is asked for nothing else.
import http, { type IncomingHttpHeaders } from 'node:http';
import https from 'node:https';
import zlib from 'node:zlib';

export interface HttpAuth {
  user?: string;
  pass?: string;
  username?: string;
  password?: string;
}

export interface GetOptions {
  /** sent with every request as basic authentication */
  auth?: HttpAuth;
  /** do not check the certificate of the server */
  insecure?: boolean;
  /** accept a compressed answer */
  gzip?: boolean;
  /**
   * Let the operating system probe the connection after it was idle for this many milliseconds,
   * so that a peer that is gone without saying so is noticed and the request fails.
   */
  keepAlive?: number;
  /** milliseconds after which a request that is not complete fails */
  timeout?: number;
}

/** a request that is under way */
export interface GetRequest {
  /** ends the request. none of its handlers is called from then on. */
  abort(): void;
}

export interface HttpResponse {
  statusCode: number;
  statusMessage: string;
  headers: IncomingHttpHeaders;
}

export interface GetHandlers {
  /** the status and the headers arrived */
  onResponse?: (response: HttpResponse) => void;
  /** a piece of the body arrived */
  onData?: (chunk: Buffer) => void;
  /** the body is complete */
  onEnd?: () => void;
  /** the request failed. nothing else is called after this. */
  onError?: (error: Error) => void;
}

/** sends a GET request and reports what comes back as it comes */
export function get(url: string, options: GetOptions, handlers: GetHandlers): GetRequest {
  const headers: Record<string, string> = {};
  if (options.auth) {
    const user = options.auth.user ?? options.auth.username ?? '';
    const pass = options.auth.pass ?? options.auth.password ?? '';
    headers.Authorization = 'Basic ' + Buffer.from(user + ':' + pass).toString('base64');
  }
  if (options.gzip) {
    headers['Accept-Encoding'] = 'gzip';
  }

  let failed = false;
  let aborted = false;
  let timer: ReturnType<typeof setTimeout> | undefined;
  const fail = (error: Error): void => {
    clearTimeout(timer);
    if (!failed) {
      failed = true;
      handlers.onError?.(error);
    }
  };

  let request: http.ClientRequest;
  try {
    request = url.startsWith('https:') ? https.get(url, { headers, rejectUnauthorized: !options.insecure }) : http.get(url, { headers });
  } catch (error) {
    // an address that is no url
    queueMicrotask(() => {
      fail(error as Error);
    });
    return { abort: () => (failed = true) };
  }

  if (options.keepAlive !== undefined) {
    const idle = options.keepAlive;
    request.on('socket', (socket) => {
      socket.setKeepAlive(true, idle);
    });
  }
  if (options.timeout !== undefined) {
    const milliseconds = options.timeout;
    timer = setTimeout(() => {
      request.destroy(new Error('no answer within ' + milliseconds / 1000 + ' seconds'));
    }, milliseconds);
  }

  request.on('error', fail);
  request.on('response', (response) => {
    handlers.onResponse?.({ statusCode: response.statusCode ?? 0, statusMessage: response.statusMessage ?? '', headers: response.headers });

    const body = response.headers['content-encoding'] === 'gzip' ? response.pipe(zlib.createGunzip()) : response;
    response.on('error', fail);
    body.on('error', fail);
    body.on('data', (chunk: Buffer) => {
      if (!aborted) {
        handlers.onData?.(chunk);
      }
    });
    body.on('end', () => {
      clearTimeout(timer);
      if (!failed) {
        handlers.onEnd?.();
      }
    });
  });

  return {
    abort: () => {
      clearTimeout(timer);
      aborted = true;
      failed = true;
      request.destroy();
    },
  };
}

/** sends a GET request and hands over the whole body as text: `callback(error)` or `callback(undefined, response, body)` */
export function getText(url: string, options: GetOptions, callback: (error: Error | undefined, response?: HttpResponse, body?: string) => void): void {
  let answered: HttpResponse | undefined;
  const chunks: Buffer[] = [];
  get(url, options, {
    onResponse: (response) => {
      answered = response;
    },
    onData: (chunk) => {
      chunks.push(chunk);
    },
    onEnd: () => {
      callback(undefined, answered, Buffer.concat(chunks).toString());
    },
    onError: (error) => {
      callback(error);
    },
  });
}
