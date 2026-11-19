// starts a real homebridge that loads the built plugin, and talks to it the way a HomeKit
// controller does. homebridge runs in insecure mode, which lets it be asked without pairing.
import { spawn, type ChildProcess } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { connect, createServer, type AddressInfo } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const root = join(import.meta.dirname, '..', '..');
const pin = '031-45-154';
const homebridgeBin = join(root, 'node_modules', 'homebridge', 'bin', 'homebridge.js');

export interface HapCharacteristic {
  aid: number;
  iid: number;
  /** the uuid, in the short form for the characteristics HomeKit defines, e.g. `25` for On */
  type: string;
  value?: unknown;
}

export interface HapService {
  /** the uuid, in the short form for the services HomeKit defines, e.g. `49` for Switch */
  type: string;
  characteristics: HapCharacteristic[];
}

export interface HapAccessory {
  aid: number;
  /** the name homebridge gave the accessory */
  name: string;
  services: HapService[];
}

interface HapAccessories {
  accessories: { aid: number; services: { type: string; characteristics: Omit<HapCharacteristic, 'aid'>[] }[] }[];
}

/** uuids of what HomeKit defines, in the short form HAP uses for them */
export const hapType = {
  AccessoryInformation: '3E',
  Name: '23',
  On: '25',
  Brightness: '8',
  CurrentTemperature: '11',
  TargetTemperature: '35',
  CurrentRelativeHumidity: '10',
  CurrentPosition: '6D',
  TargetPosition: '7C',
  ContactSensorState: '6A',
  LockCurrentState: '1D',
  LockTargetState: '1E',
  Switch: '49',
  Outlet: '47',
  Lightbulb: '43',
  Thermostat: '4A',
  WindowCovering: '8C',
  ContactSensor: '80',
  TemperatureSensor: '8A',
  HumiditySensor: '82',
  LockMechanism: '45',
} as const;

/** the short form HAP uses for a uuid HomeKit defines. other uuids stay as they are. */
export function shortType(uuid: string): string {
  const match = /^0*([0-9A-F]+)-0000-1000-8000-0026BB765291$/i.exec(uuid);
  return (match?.[1] ?? uuid).toUpperCase();
}

/** a value homebridge sent on its own, because the characteristic changed */
export interface HapEvent {
  aid: number;
  iid: number;
  value: unknown;
}

/** a connection of a controller that asked to be told about changes */
export interface HapSubscription {
  /** the events received so far */
  events: HapEvent[];
  close(): void;
}

export interface Homebridge {
  /** everything homebridge wrote to its log */
  output(): string;
  /** the accessories homebridge publishes, without the bridge itself. rejects while homebridge is not up yet. */
  accessories(): Promise<HapAccessory[]>;
  read(characteristic: HapCharacteristic): Promise<unknown>;
  write(characteristic: HapCharacteristic, value: unknown): Promise<void>;
  /** asks to be told about changes of the characteristics, on a connection that stays open as the one of a controller does */
  subscribe(characteristics: HapCharacteristic[]): Promise<HapSubscription>;
  stop(): Promise<void>;
}

function freePort(): Promise<number> {
  return new Promise((resolve) => {
    const server = createServer();
    server.listen(0, '127.0.0.1', () => {
      const { port } = server.address() as AddressInfo;
      server.close(() => {
        resolve(port);
      });
    });
  });
}

/**
 * @param platform the configuration of the FHEM platform
 * @param files files to put into the storage directory of homebridge, by name
 */
export async function startHomebridge(platform: Record<string, unknown>, files: Record<string, string> = {}): Promise<Homebridge> {
  const storage = mkdtempSync(join(tmpdir(), 'fhem2hb-e2e-'));
  for (const [name, content] of Object.entries(files)) {
    writeFileSync(join(storage, name), content);
  }
  const port = await freePort();
  writeFileSync(
    join(storage, 'config.json'),
    JSON.stringify({
      bridge: { name: 'fhem2hb e2e', username: '0E:2E:2E:2E:2E:01', port, pin },
      // the debug page of the plugin would take a fixed port of this machine
      platforms: [{ platform: 'FHEM', name: 'FHEM', debugPort: false, ...platform }],
    }),
  );

  let output = '';
  const child: ChildProcess = spawn(process.execPath, [homebridgeBin, '-I', '-Q', '-U', storage, '-P', root, '--strict-plugin-resolution'], {
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  child.stdout?.on('data', (chunk: Buffer) => {
    output += chunk.toString();
  });
  child.stderr?.on('data', (chunk: Buffer) => {
    output += chunk.toString();
  });

  const hap = `http://127.0.0.1:${port}`;

  return {
    output: () => output,

    async accessories() {
      const response = await fetch(`${hap}/accessories`);
      if (!response.ok) {
        throw new Error(`homebridge answered ${response.status}`);
      }
      const { accessories } = (await response.json()) as HapAccessories;
      // the bridge itself is accessory 1
      return accessories
        .filter((accessory) => accessory.aid !== 1)
        .map((accessory) => {
          const services = accessory.services.map((service) => ({
            type: service.type.toUpperCase(),
            characteristics: service.characteristics.map((characteristic) => {
              return { ...characteristic, type: characteristic.type.toUpperCase(), aid: accessory.aid };
            }),
          }));
          const information = services.find((service) => service.type === hapType.AccessoryInformation);
          const name = information?.characteristics.find((characteristic) => characteristic.type === hapType.Name)?.value;
          return { aid: accessory.aid, name: String(name), services };
        });
    },

    async read({ aid, iid }) {
      const response = await fetch(`${hap}/characteristics?id=${aid}.${iid}`);
      const { characteristics } = (await response.json()) as { characteristics: { value: unknown }[] };
      return characteristics[0]?.value;
    },

    async write({ aid, iid }, value) {
      const response = await fetch(`${hap}/characteristics`, {
        method: 'PUT',
        // without pairing, a write is authorized with the pin of the bridge
        headers: { 'Content-Type': 'application/hap+json', Authorization: pin },
        body: JSON.stringify({ characteristics: [{ aid, iid, value }] }),
      });
      if (!response.ok) {
        throw new Error(`homebridge answered ${response.status} to the write`);
      }
    },

    subscribe(characteristics) {
      // HAP sends events as messages of their own down the connection the subscription was made
      // on: `EVENT/1.0 200 OK`, headers, and a JSON body. fetch can not read those, so this
      // speaks HTTP over a socket by hand.
      const body = JSON.stringify({ characteristics: characteristics.map(({ aid, iid }) => ({ aid, iid, ev: true })) });
      const events: HapEvent[] = [];

      return new Promise((resolve, reject) => {
        const socket = connect(port, '127.0.0.1');
        let received = '';
        let subscribed = false;

        const takeMessages = (): void => {
          for (;;) {
            const headEnd = received.indexOf('\r\n\r\n');
            if (headEnd < 0) {
              return;
            }
            const head = received.slice(0, headEnd);
            const length = Number(/^content-length: *(\d+)/im.exec(head)?.[1] ?? 0);
            // the messages are ASCII, so characters are bytes
            if (received.length < headEnd + 4 + length) {
              return;
            }
            const content = received.slice(headEnd + 4, headEnd + 4 + length);
            received = received.slice(headEnd + 4 + length);

            if (head.startsWith('EVENT/1.0 200')) {
              events.push(...(JSON.parse(content) as { characteristics: HapEvent[] }).characteristics);
            } else if (!subscribed && /^HTTP\/1\.1 20[47]/.test(head) && !content.includes('"status":-')) {
              subscribed = true;
              resolve({
                events,
                close: () => {
                  socket.destroy();
                },
              });
            } else if (!subscribed) {
              socket.destroy();
              reject(new Error(`homebridge answered the subscription with: ${head.split('\r\n')[0]} ${content}`));
            }
          }
        };

        socket.setEncoding('latin1');
        socket.on('data', (chunk: string) => {
          received += chunk;
          takeMessages();
        });
        socket.on('error', reject);
        socket.on('connect', () => {
          socket.write(
            'PUT /characteristics HTTP/1.1\r\n' +
              `Host: 127.0.0.1:${port}\r\n` +
              'Content-Type: application/hap+json\r\n' +
              // without pairing, the request is authorized with the pin of the bridge
              `Authorization: ${pin}\r\n` +
              `Content-Length: ${Buffer.byteLength(body)}\r\n\r\n` +
              body,
          );
        });
      });
    },

    stop() {
      return new Promise((resolve) => {
        child.once('exit', () => {
          rmSync(storage, { recursive: true, force: true });
          resolve();
        });
        child.kill('SIGTERM');
      });
    },
  };
}
