import type { Logging } from 'homebridge';
import * as hap from '@homebridge/hap-nodejs';
import https from 'node:https';
import type { AddressInfo } from 'node:net';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createLog } from '../../test/support/log.ts';
import { selfSignedCertificate } from '../../test/support/tls.ts';
import { PluginState } from '../state/pluginState.ts';
import { describeError, execute, fetchDevices, isCertificateError, requestOptions, type DeviceList, type FhemConnection } from './client.ts';

const log = createLog() as unknown as Logging;

describe('requestOptions', () => {
  it('checks the certificate of the server when the connection says so, with and without user and password', () => {
    expect(requestOptions({ base_url: 'https://fhem', log, rejectUnauthorized: true })).toEqual({});
    expect(requestOptions({ base_url: 'https://fhem', log, auth: { user: 'u', pass: 'p' }, rejectUnauthorized: true })).toEqual({
      auth: { user: 'u', pass: 'p' },
    });
  });

  it('checks it without user and password, and not with them, when the connection says nothing', () => {
    expect(requestOptions({ base_url: 'https://fhem', log })).toEqual({});
    expect(requestOptions({ base_url: 'https://fhem', log, auth: { user: 'u', pass: 'p' } })).toEqual({ auth: { user: 'u', pass: 'p' }, insecure: true });
  });

  it('does not check it when the connection says not to', () => {
    expect(requestOptions({ base_url: 'https://fhem', log, rejectUnauthorized: false })).toEqual({ insecure: true });
    expect(requestOptions({ base_url: 'https://fhem', log, auth: { user: 'u' }, rejectUnauthorized: false })).toEqual({ auth: { user: 'u' }, insecure: true });
  });
});

describe('a fhem with a certificate it signed itself', () => {
  let server: https.Server;
  let base_url: string;
  let requests: (string | undefined)[];

  beforeAll(async () => {
    server = https.createServer(selfSignedCertificate(), (request, response) => {
      requests.push(request.headers.authorization);
      response.end(request.url?.includes('jsonlist2') ? JSON.stringify({ Results: [], totalResultsReturned: 0 }) : 'done\n');
    });
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
    base_url = `https://127.0.0.1:${(server.address() as AddressInfo).port}/fhem`;
  });

  afterAll(() => {
    server.closeAllConnections();
    server.close();
  });

  /** runs a command and waits for what the plugin makes of it: the answer, or the line it logs */
  function run(connection: Omit<FhemConnection, 'base_url' | 'log'>): Promise<{ answer?: string; lines: string[] }> {
    requests = [];
    const captured = createLog();
    return new Promise((resolve) => {
      const failed = setInterval(() => {
        if (captured.lines.some((line) => line.includes('problem connecting'))) {
          clearInterval(failed);
          resolve({ lines: captured.lines });
        }
      }, 5);
      execute(new PluginState(hap), captured as unknown as Logging, { base_url, log, ...connection }, 'set lamp on', (answer) => {
        clearInterval(failed);
        resolve({ answer, lines: captured.lines });
      });
    });
  }

  it('is not talked to without user and password', async () => {
    const { answer, lines } = await run({});

    expect(answer).toBeUndefined();
    expect(requests).toEqual([]);
    expect(lines.at(-1)).toMatch(
      /problem connecting to FHEM .*:Error: self-signed certificate.*\(the certificate of fhem is not trusted\..*rejectUnauthorized/,
    );
  });

  it('is talked to with user and password, and is sent them, when the connection says nothing about its certificate', async () => {
    const { answer } = await run({ auth: { user: 'fhem', pass: 'secret' } });

    expect(answer).toBe('done');
    expect(requests).toEqual(['Basic ' + Buffer.from('fhem:secret').toString('base64')]);
  });

  it.each([
    ['without', {}],
    ['with', { auth: { user: 'fhem', pass: 'secret' } }],
  ])('is not talked to %s user and password when the connection insists on a certificate that can be verified', async (_what, auth) => {
    const { answer, lines } = await run({ ...auth, rejectUnauthorized: true });

    expect(answer).toBeUndefined();
    expect(requests).toEqual([]);
    expect(lines.at(-1)).toContain('self-signed certificate');
  });

  it.each([
    ['without', {}, undefined],
    ['with', { auth: { user: 'fhem', pass: 'secret' } }, 'Basic ' + Buffer.from('fhem:secret').toString('base64')],
  ])('is talked to %s user and password when the connection does not ask for a certificate that can be verified', async (_what, auth, authorization) => {
    const { answer } = await run({ ...auth, rejectUnauthorized: false });

    expect(answer).toBe('done');
    expect(requests).toEqual([authorization]);
  });

  it('lists its devices unless its certificate is to be checked', async () => {
    const list = (connection: Omit<FhemConnection, 'base_url' | 'log'>) =>
      new Promise<{ error?: Error; devices?: DeviceList }>((resolve) => {
        fetchDevices(new PluginState(hap), log, { base_url, log, ...connection }, undefined, (error, _response, devices) => {
          resolve({ error, devices });
        });
      });

    const refused = await list({});
    expect(refused.devices).toBeUndefined();
    expect(isCertificateError(refused.error as Error)).toBe(true);
    expect(describeError(refused.error as Error)).toContain('set rejectUnauthorized to false for the platform');

    expect((await list({ rejectUnauthorized: false })).devices).toEqual({ Results: [], totalResultsReturned: 0 });
    expect((await list({ auth: { user: 'fhem', pass: 'secret' } })).devices).toEqual({ Results: [], totalResultsReturned: 0 });
    expect((await list({ auth: { user: 'fhem', pass: 'secret' }, rejectUnauthorized: true })).devices).toBeUndefined();
  });
});

describe('describeError', () => {
  it('says nothing about certificates for other errors', () => {
    expect(isCertificateError(new Error('connect ECONNREFUSED'))).toBe(false);
    expect(describeError(Object.assign(new Error('connect ECONNREFUSED'), { code: 'ECONNREFUSED' }))).toBe('Error: connect ECONNREFUSED');
  });
});
