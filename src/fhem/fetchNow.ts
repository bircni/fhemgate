// the devices of fhem, fetched while homebridge waits
import { spawnSync } from 'node:child_process';
import { extname, join } from 'node:path';
import type { Jsonlist2Device } from '../devices/types.ts';
import type { FhemConnection } from './client.ts';

/** how one fhem is asked for its devices */
export type DevicesRequest = Pick<FhemConnection, 'base_url' | 'auth' | 'rejectUnauthorized'> & { filter?: string };

/** milliseconds homebridge is kept waiting for the devices at most */
const FETCH_NOW_TIMEOUT = 30_000;

/**
 * The devices each fhem lists, asked for and answered before this returns. Undefined for a fhem
 * that does not answer in time, or without a request.
 *
 * homebridge publishes the bridge right after it told the platforms that it has restored what
 * it kept, and does not wait for anything they start then. So the requests run in a process of
 * their own, which this one waits for: homebridge does nothing else meanwhile, for at most
 * FETCH_NOW_TIMEOUT. That is only done on the first start after homebridge-fhem.
 */
export function fetchDevicesNow(
  requests: (DevicesRequest | undefined)[],
  { timeout = FETCH_NOW_TIMEOUT, log }: { timeout?: number; log?: { error(message: string): void } } = {},
): (Jsonlist2Device[] | undefined)[] {
  const script = join(import.meta.dirname, 'listDevices' + extname(import.meta.filename));
  // the child ends its requests a little before, so that it has the time to write what it got
  const child = spawnSync(process.execPath, [script, String(timeout - 5000)], {
    input: JSON.stringify(requests),
    encoding: 'utf8',
    timeout: timeout,
    maxBuffer: 256 * 1024 * 1024,
  });

  let answer: unknown;
  try {
    answer = JSON.parse(child.stdout);
  } catch {
    log?.error('migrateFrom: the devices could not be fetched (' + String(child.error ?? child.signal ?? child.stderr) + ')');
  }
  return requests.map((_request, index) => {
    const devices: unknown = Array.isArray(answer) ? answer[index] : undefined;
    return Array.isArray(devices) ? (devices as Jsonlist2Device[]) : undefined;
  });
}
