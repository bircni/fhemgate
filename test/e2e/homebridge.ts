// starts a real homebridge that loads the built plugin, and talks to it the way a HomeKit
// controller does. homebridge runs in insecure mode, which lets it be asked without pairing.
import { spawn } from 'node:child_process';
import { closeSync, existsSync, mkdtempSync, openSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { connect, createServer, type AddressInfo, type Socket } from 'node:net';
import { join } from 'node:path';
import { inject } from 'vitest';

const root = join(import.meta.dirname, '..', '..');
const pin = '031-45-154';
const homebridgeBin = join(root, 'node_modules', 'homebridge', 'bin', 'homebridge.js');

export interface HapCharacteristic {
  aid: number;
  iid: number;
  /** the uuid, in the short form for the characteristics HomeKit defines, e.g. `25` for On */
  type: string;
  value?: unknown;
  /** what the controller may do with it: `pr` read, `pw` write, `ev` be notified */
  perms?: string[];
  format?: string;
  unit?: string;
  description?: string;
  minValue?: number;
  maxValue?: number;
  minStep?: number;
  'valid-values'?: number[];
}

export interface HapService {
  iid: number;
  /** the uuid, in the short form for the services HomeKit defines, e.g. `49` for Switch */
  type: string;
  characteristics: HapCharacteristic[];
  /** the iids of the services this one is linked to */
  linked?: number[];
}

export interface HapAccessory {
  aid: number;
  /** the name homebridge gave the accessory */
  name: string;
  services: HapService[];
}

interface HapAccessories {
  accessories: { aid: number; services: (Omit<HapService, 'characteristics'> & { characteristics: Omit<HapCharacteristic, 'aid'>[] })[] }[];
}

/** a change of a characteristic, as homebridge tells a controller that asked to be notified */
export interface HapNotification {
  aid: number;
  iid: number;
  value: unknown;
}

/** uuids of what HomeKit defines, in the short form HAP uses for them */
export const hapType = {
  // services
  AccessoryInformation: '3E',
  AirQualitySensor: '8D',
  BatteryService: '96',
  ContactSensor: '80',
  Fan: '40',
  GarageDoorOpener: '41',
  HumiditySensor: '82',
  InputSource: 'D9',
  LightSensor: '84',
  Lightbulb: '43',
  LockMechanism: '45',
  MotionSensor: '85',
  OccupancySensor: '86',
  Outlet: '47',
  SecuritySystem: '7E',
  Switch: '49',
  Television: 'D8',
  TemperatureSensor: '8A',
  Thermostat: '4A',
  Window: '8B',
  WindowCovering: '8C',

  // characteristics
  Active: 'B0',
  ActiveIdentifier: 'E7',
  AirQuality: '95',
  BatteryLevel: '68',
  Brightness: '8',
  CarbonDioxideLevel: '93',
  ChargingState: '8F',
  ColorTemperature: 'CE',
  ContactSensorState: '6A',
  CurrentAmbientLightLevel: '6B',
  CurrentDoorState: 'E',
  CurrentHeatingCoolingState: 'F',
  CurrentPosition: '6D',
  CurrentRelativeHumidity: '10',
  CurrentTemperature: '11',
  FirmwareRevision: '52',
  Hue: '13',
  Identifier: 'E6',
  Identify: '14',
  LockCurrentState: '1D',
  LockTargetState: '1E',
  Manufacturer: '20',
  Model: '21',
  MotionDetected: '22',
  Name: '23',
  ObstructionDetected: '24',
  OccupancyDetected: '71',
  On: '25',
  OutletInUse: '26',
  PositionState: '72',
  RotationSpeed: '29',
  Saturation: '2F',
  SecuritySystemCurrentState: '66',
  SecuritySystemTargetState: '67',
  SerialNumber: '30',
  StatusLowBattery: '79',
  TargetDoorState: '32',
  TargetHeatingCoolingState: '33',
  TargetPosition: '7C',
  TargetTemperature: '35',
  TemperatureDisplayUnits: '36',
} as const;

/** uuids of what Eve defines and the plugin publishes, and the volume characteristic of the plugin itself */
export const eveType = {
  CT: 'E887EF67-509A-552D-A138-3DA215050F46',
  xVolume: '4648454D-0101-686F-6D65-627269646765',
  History: 'E863F007-079E-48FF-8F27-9C2605A29F52',
  Volume: '00001001-0000-1000-8000-135D67EC4377',
  Voltage: 'E863F10A-079E-48FF-8F27-9C2605A29F52',
  Current: 'E863F126-079E-48FF-8F27-9C2605A29F52',
  Power: 'E863F10D-079E-48FF-8F27-9C2605A29F52',
  Energy: 'E863F10C-079E-48FF-8F27-9C2605A29F52',
  AirPressure: 'E863F10F-079E-48FF-8F27-9C2605A29F52',
  Actuation: 'E863F12E-079E-48FF-8F27-9C2605A29F52',
  Reset: 'E863F112-079E-48FF-8F27-9C2605A29F52',
  TimesOpened: 'E863F129-079E-48FF-8F27-9C2605A29F52',
  LastActivation: 'E863F11A-079E-48FF-8F27-9C2605A29F52',
  OpenDuration: 'E863F118-079E-48FF-8F27-9C2605A29F52',
  ClosedDuration: 'E863F119-079E-48FF-8F27-9C2605A29F52',
} as const;

/** everything above by name */
export const uuids = { ...hapType, ...eveType } as const;
export type TypeName = keyof typeof uuids;

/** the short form HAP uses for a uuid HomeKit defines. other uuids stay as they are. */
export function shortType(uuid: string): string {
  const match = /^0*([0-9A-F]+)-0000-1000-8000-0026BB765291$/i.exec(uuid);
  return (match?.[1] ?? uuid).toUpperCase();
}

/** a connection of a controller that asked to be told about changes */
export interface HapSubscription {
  /** the changes received on this connection so far */
  events: HapNotification[];
  close(): void;
}

export interface Homebridge {
  /** the directory homebridge keeps its configuration and the plugin its files in */
  storage: string;
  /** everything homebridge wrote to its log */
  output(): string;
  /** the accessories homebridge publishes, without the bridge itself. rejects while homebridge is not up yet. */
  accessories(): Promise<HapAccessory[]>;
  /** the value homebridge answers a controller that reads the characteristic. undefined if the read is answered with an error. */
  read(characteristic: HapCharacteristic): Promise<unknown>;
  write(characteristic: HapCharacteristic, value: unknown): Promise<void>;
  /** asks to be told about changes of the characteristics, on a connection that stays open as the one of a controller does */
  subscribe(characteristics: HapCharacteristic[]): Promise<HapSubscription>;
  /** the changes homebridge has told about on all subscriptions, oldest first */
  notifications(): HapNotification[];
  /** the code homebridge ended with, once it has ended */
  exited(): Promise<number | null>;
  /**
   * Asks homebridge to end and waits until it has told the plugin. homebridge itself takes up to
   * five seconds more to end, which is only waited for with `untilExited`.
   */
  stop(options?: { untilExited?: boolean }): Promise<void>;
}

/** a port of this machine nothing listens on */
export function freePort(): Promise<number> {
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

/** the notifications homebridge sends down a connection that asked for them */
function listen(port: number, characteristics: HapCharacteristic[], notified: (notifications: HapNotification[]) => void): Promise<Socket> {
  return new Promise((resolve, reject) => {
    const socket = connect(port, '127.0.0.1');
    let received = '';
    let acknowledged = false;

    socket.on('error', reject);
    socket.on('connect', () => {
      const body = JSON.stringify({ characteristics: characteristics.map(({ aid, iid }) => ({ aid, iid, ev: true })) });
      socket.write(
        `PUT /characteristics HTTP/1.1\r\nHost: 127.0.0.1:${port}\r\nContent-Type: application/hap+json\r\n` +
          `Authorization: ${pin}\r\nContent-Length: ${Buffer.byteLength(body)}\r\n\r\n${body}`,
      );
    });
    socket.on('data', (chunk: Buffer) => {
      received += chunk.toString();
      // the answer to the request first, then one message per notification
      for (;;) {
        const headEnd = received.indexOf('\r\n\r\n');
        if (headEnd < 0) {
          return;
        }
        const head = received.slice(0, headEnd);
        const length = Number(/content-length: *(\d+)/i.exec(head)?.[1] ?? 0);
        if (received.length < headEnd + 4 + length) {
          return;
        }
        const body = received.slice(headEnd + 4, headEnd + 4 + length);
        received = received.slice(headEnd + 4 + length);

        if (head.startsWith('EVENT/1.0')) {
          notified((JSON.parse(body) as { characteristics: HapNotification[] }).characteristics);
        } else if (!acknowledged) {
          acknowledged = true;
          // 207 with a negative status is the answer when one of the characteristics can not notify
          if (/^HTTP\/1\.1 20[47]/.test(head) && !body.includes('"status":-')) {
            resolve(socket);
          } else {
            reject(new Error(`homebridge answered the subscription with: ${head.split('\r\n')[0]} ${body}`));
          }
        }
      }
    });
  });
}

/**
 * @param platforms the configuration of the FHEM platform, or of several
 * @param files files to put into the storage directory of homebridge, by name
 * @param storage the storage directory of a homebridge that has ended, to start it again with what it kept there
 */
export async function startHomebridge(
  platforms: Record<string, unknown> | Record<string, unknown>[],
  files: Record<string, string> = {},
  storage = mkdtempSync(join(inject('e2eDirectory'), 'homebridge-')),
): Promise<Homebridge> {
  rmSync(join(storage, 'stopping'), { force: true });
  for (const [name, content] of Object.entries(files)) {
    writeFileSync(join(storage, name), content);
  }
  const port = await freePort();
  const hex = (byte: number) => (byte & 0xff).toString(16).padStart(2, '0').toUpperCase();
  writeFileSync(
    join(storage, 'config.json'),
    JSON.stringify({
      // several bridges run at the same time, each needs a name and an id of its own
      bridge: { name: `fhem2hb e2e ${port}`, username: `0E:2E:2E:2E:${hex(port >> 8)}:${hex(port)}`, port, pin },
      platforms: (Array.isArray(platforms) ? platforms : [platforms]).map((platform, index) => ({
        platform: 'FHEM',
        name: index ? `FHEM ${index + 1}` : 'FHEM',
        // the debug page of the plugin would take a fixed port of this machine
        debugPort: false,
        ...platform,
      })),
    }),
  );

  // the log goes to a file, so that homebridge can go on writing it after the test that started it is over
  const logFile = join(storage, 'homebridge.log');
  const log = openSync(logFile, 'w');
  const env: NodeJS.ProcessEnv = { ...process.env };
  if (process.env.E2E_V8_COVERAGE) {
    // node writes what the process ran into this directory when the process ends
    env.NODE_V8_COVERAGE = process.env.E2E_V8_COVERAGE;
  }
  const child = spawn(process.execPath, [homebridgeBin, '-I', '-Q', '-U', storage, '-P', root, '--strict-plugin-resolution'], {
    env,
    stdio: ['ignore', log, log],
  });
  closeSync(log);

  const pidFile = join(storage, 'pid');
  writeFileSync(pidFile, String(child.pid));
  const exited = new Promise<number | null>((resolve) => {
    child.once('exit', (code) => {
      rmSync(pidFile, { force: true });
      resolve(code);
    });
  });

  const hap = `http://127.0.0.1:${port}`;
  const output = () => readFileSync(logFile, 'utf8');
  const notifications: HapNotification[] = [];
  const listeners: Socket[] = [];

  return {
    storage,
    output,

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
            ...service,
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

    async subscribe(characteristics) {
      const events: HapNotification[] = [];
      const socket = await listen(port, characteristics, (received) => {
        events.push(...received);
        notifications.push(...received);
      });
      listeners.push(socket);
      return {
        events,
        close: () => {
          socket.destroy();
        },
      };
    },

    notifications: () => notifications,

    exited: () => exited,

    async stop({ untilExited = false } = {}) {
      for (const listener of listeners) {
        listener.destroy();
      }
      if (existsSync(pidFile)) {
        // tells the teardown of the run that this process is on its way out
        writeFileSync(join(storage, 'stopping'), '');
        child.kill('SIGTERM');
      }
      if (untilExited) {
        await exited;
        return;
      }

      // homebridge logs the signal and tells the plugins in the same breath
      const told = new Promise<void>((resolve) => {
        const timer = setInterval(() => {
          if (output().includes('Got SIGTERM') || !existsSync(pidFile)) {
            clearInterval(timer);
            resolve();
          }
        }, 50);
      });
      await Promise.race([told, exited]);
    },
  };
}

/** the files in the storage directory of homebridge whose names end as given */
export function storedFiles(homebridge: Homebridge, ending: string): string[] {
  return readdirSync(homebridge.storage)
    .filter((name) => name.endsWith(ending))
    .map((name) => join(homebridge.storage, name));
}
