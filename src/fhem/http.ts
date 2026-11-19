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
export function get(url: string, options: GetOptions, handlers: GetHandlers): void {
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
  const fail = (error: Error): void => {
    if (!failed) {
      failed = true;
      handlers.onError?.(error);
    }
  };

  let request: http.ClientRequest;
  try {
    request = url.startsWith('https:')
      ? https.get(url, { headers, rejectUnauthorized: !options.insecure })
      : http.get(url, { headers });
  } catch (error) {
    // an address that is no url
    queueMicrotask(() => {
      fail(error as Error);
    });
    return;
  }

  request.on('error', fail);
  request.on('response', (response) => {
    handlers.onResponse?.({ statusCode: response.statusCode ?? 0, statusMessage: response.statusMessage ?? '', headers: response.headers });

    const body = response.headers['content-encoding'] === 'gzip' ? response.pipe(zlib.createGunzip()) : response;
    response.on('error', fail);
    body.on('error', fail);
    body.on('data', (chunk: Buffer) => {
      handlers.onData?.(chunk);
    });
    body.on('end', () => {
      if (!failed) {
        handlers.onEnd?.();
      }
    });
  });
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
