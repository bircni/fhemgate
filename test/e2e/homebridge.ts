// starts a real homebridge that loads the built plugin, and talks to it the way a HomeKit
// controller does. homebridge runs in insecure mode, which lets it be asked without pairing.
import { spawn, type ChildProcess } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { createServer, type AddressInfo } from 'node:net';
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

export interface Homebridge {
  /** everything homebridge wrote to its log */
  output(): string;
  /** the accessories homebridge publishes, without the bridge itself. rejects while homebridge is not up yet. */
  accessories(): Promise<HapAccessory[]>;
  read(characteristic: HapCharacteristic): Promise<unknown>;
  write(characteristic: HapCharacteristic, value: unknown): Promise<void>;
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
  writeFileSync(join(storage, 'config.json'), JSON.stringify({
    bridge: { name: 'fhem2hb e2e', username: '0E:2E:2E:2E:2E:01', port, pin },
    platforms: [{ platform: 'FHEM', name: 'FHEM', ...platform }],
  }));

  let output = '';
  const child: ChildProcess = spawn(process.execPath, [homebridgeBin, '-I', '-Q', '-U', storage, '-P', root, '--strict-plugin-resolution'], {
    // the debug server of the plugin would take a fixed port of this machine
    env: { ...process.env, FHEM2HB_DEBUG_SERVER: 'off' },
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
      const { accessories } = await response.json() as HapAccessories;
      // the bridge itself is accessory 1
      return accessories.filter((accessory) => accessory.aid !== 1).map((accessory) => {
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
      const { characteristics } = await response.json() as { characteristics: { value: unknown }[] };
      return characteristics[0]?.value;
    },

    async write({ aid, iid }, value) {
      const response = await fetch(`${hap}/characteristics`, {
        method: 'PUT',
        // without pairing, a write is authorized with the pin of the bridge
        headers: { 'Content-Type': 'application/hap+json', 'Authorization': pin },
        body: JSON.stringify({ characteristics: [{ aid, iid, value }] }),
      });
      if (!response.ok) {
        throw new Error(`homebridge answered ${response.status} to the write`);
      }
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
