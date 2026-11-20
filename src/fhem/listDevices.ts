// run by fetchDevicesNow as a process of its own: asks each fhem for its devices and writes the
// lists as JSON, a list or null for each fhem it was given
import { readFileSync } from 'node:fs';
import { csrfTokenOf, deviceList, requestOptions } from './client.ts';
import type { DevicesRequest } from './fetchNow.ts';
import { getText } from './http.ts';
import { devicesUrl } from './protocol.ts';

/** milliseconds every fhem has for both of its requests, so that the lists of the others are written before the process is ended */
const deadline = Number(process.argv[2]);

/** the devices of a fhem: its csrf token is taken from a first request, then the devices are asked for with it */
function list(request: DevicesRequest): Promise<unknown[] | null> {
  const options = { ...requestOptions(request), gzip: true, timeout: deadline / 2 };
  return new Promise((resolve) => {
    getText(request.base_url + '?XHR=1', options, (error, response) => {
      if (error || !response) {
        resolve(null);
        return;
      }
      getText(devicesUrl(request.base_url, request.filter, csrfTokenOf(response)), options, (failure, answer, body) => {
        resolve((!failure && answer?.statusCode === 200 && deviceList(body)?.Results) || null);
      });
    });
  });
}

const requests = JSON.parse(readFileSync(0, 'utf8')) as (DevicesRequest | null)[];
const late = new Promise<null>((resolve) => setTimeout(() => resolve(null), deadline).unref());
const lists = await Promise.all(requests.map((request) => (request ? Promise.race([list(request), late]) : Promise.resolve(null))));
process.stdout.write(JSON.stringify(lists));
