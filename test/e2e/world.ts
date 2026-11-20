// a fhem with dummy devices and a homebridge that publishes them, and how a test looks at the two
import { setTimeout as sleep } from 'node:timers/promises';
import type { FakeFhemOptions } from '../support/fhemweb.ts';
import type { FhemDevice } from '../support/types.ts';
import { startFhemWith, startStandIn, type DummyDevice, type FhemUnderTest, type StandIn } from './fhem.ts';
import { hapType, startHomebridge, uuids, type HapAccessory, type HapCharacteristic, type HapService, type Homebridge, type TypeName } from './homebridge.ts';

/** what homebridge logged, for the message of a failure */
const said = (homebridge: Homebridge | undefined) => (homebridge ? ` homebridge said:\n${homebridge.output()}` : '');

/** tries until the attempt answers something, for 20 seconds if not told otherwise */
export async function eventually<T>(
  what: string,
  attempt: () => Promise<T | undefined> | T | undefined,
  homebridge?: Homebridge,
  milliseconds = 20_000,
): Promise<T> {
  const deadline = Date.now() + milliseconds;
  for (;;) {
    let result: T | undefined;
    try {
      result = await attempt();
    } catch {
      result = undefined;
    }
    if (result !== undefined) {
      return result;
    }
    if (Date.now() > deadline) {
      throw new Error(`timed out waiting for ${what}.${said(homebridge)}`);
    }
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
}

/** the accessories of a homebridge once it publishes at least that many */
export function published(homebridge: Homebridge, atLeast = 1): Promise<HapAccessory[]> {
  return eventually(
    `homebridge to publish ${atLeast} accessories`,
    async () => {
      const accessories = await homebridge.accessories();
      return accessories.length >= atLeast ? accessories : undefined;
    },
    homebridge,
    60_000,
  );
}

/**
 * Resolves once homebridge has logged nothing new for a second, or after twenty seconds: the
 * platform publishes the accessories as soon as fhem listed the devices, and what fhem answers
 * then comes in a moment later.
 */
export async function quiet(homebridge: Homebridge): Promise<void> {
  const until = performance.now() + 20_000;
  let before = -1;
  for (let now = homebridge.output().length; now !== before; now = homebridge.output().length) {
    if (performance.now() > until) {
      // a real fhem can send events all the time. what the tests then see is what has arrived so far.
      process.stderr.write('homebridge did not stop logging for a second within twenty seconds\n');
      return;
    }
    before = now;
    await sleep(1000);
  }
}

/** the services of the accessories other than the accessory information, by accessory name */
export function servicesByName(accessories: HapAccessory[]): Record<string, string[]> {
  return Object.fromEntries(
    accessories.map((accessory) => [accessory.name, accessory.services.map((service) => service.type).filter((type) => type !== hapType.AccessoryInformation)]),
  );
}

export interface World {
  fhem: FhemUnderTest;
  homebridge: Homebridge;
  accessories: HapAccessory[];
  /** the accessory for the fhem device */
  accessory(device: string): HapAccessory;
  /**
   * The service of that type of the accessory for the fhem device. `name` picks one of several
   * services of a type by the value of its Name characteristic.
   */
  service(device: string, type: string, name?: string): HapService;
  /** the characteristic of the accessory for the fhem device. `name` as for `service`. */
  characteristic(device: string, service: string, type: string, name?: string): HapCharacteristic;
  /** the same, with service and characteristic given by their names in HomeKit or Eve */
  named(device: string, service: TypeName, type: TypeName, name?: string): HapCharacteristic;
  /**
   * The types of the characteristics of the service, without its name, in the order of their
   * ids. HomeKit knows them by the ids. HAP-NodeJS lists them in another order for a moment
   * after an accessory was added to a bridge that is published already.
   */
  characteristicsOf(device: string, service: string, name?: string): string[];
  /** resolves once a read of the characteristic answers the value */
  becomes(target: HapCharacteristic, value: number | string): Promise<void>;
  /** runs the action and resolves once homebridge has told its controllers that the characteristic changed to the value */
  notifies(target: HapCharacteristic, value: number | string, action: () => Promise<void>): Promise<void>;
  close(): Promise<void>;
}

const same = (actual: unknown, expected: number | string) => (typeof expected === 'number' ? Number(actual) === expected : actual === expected);

/** looks at accessories that are published already */
export function worldOf(fhem: FhemUnderTest, homebridge: Homebridge, accessories: HapAccessory[], nameOf: (device: string) => string): World {
  const world: World = {
    fhem,
    homebridge,
    accessories,

    accessory(device) {
      const accessory = accessories.find((candidate) => candidate.name === nameOf(device));
      if (!accessory) {
        throw new Error(`there is no accessory for ${device}, only for: ${accessories.map((candidate) => candidate.name).join(', ')}`);
      }
      return accessory;
    },

    service(device, type, name) {
      const found = world.accessory(device).services.find((candidate) => {
        const itsName = candidate.characteristics.find((characteristic) => characteristic.type === hapType.Name)?.value;
        return candidate.type === type && (name === undefined || itsName === name);
      });
      if (!found) {
        throw new Error(`${device} has no service ${type}${name ? ` named ${name}` : ''}`);
      }
      return found;
    },

    characteristic(device, service, type, name) {
      const found = world.service(device, service, name).characteristics.find((candidate) => candidate.type === type);
      if (!found) {
        throw new Error(`${device} has no characteristic ${type} on its service ${service}`);
      }
      return found;
    },

    named: (device, service, type, name) => world.characteristic(device, uuids[service], uuids[type], name),

    characteristicsOf: (device, service, name) =>
      world
        .service(device, service, name)
        .characteristics.slice()
        .sort((a, b) => a.iid - b.iid)
        .map((characteristic) => characteristic.type)
        .filter((type) => type !== hapType.Name),

    async becomes(target, value) {
      let last: unknown;
      await eventually(
        `characteristic ${target.aid}.${target.iid} to become ${value}, it is ${String(last)}`,
        async () => {
          last = await homebridge.read(target);
          return same(last, value) ? true : undefined;
        },
        homebridge,
      );
    },

    async notifies(target, value, action) {
      const before = homebridge.notifications().length;
      await action();
      await eventually(
        `homebridge to tell that characteristic ${target.aid}.${target.iid} changed to ${value}`,
        () =>
          homebridge
            .notifications()
            .slice(before)
            .some((notification) => notification.aid === target.aid && notification.iid === target.iid && same(notification.value, value))
            ? true
            : undefined,
        homebridge,
      );
    },

    async close() {
      await homebridge.stop();
      await fhem.close();
    },
  };
  return world;
}

export interface WorldOptions {
  /** the room the devices are put into. every test file uses its own. */
  room: string;
  /** added to the configuration of the FHEM platform */
  platform?: Record<string, unknown>;
  /** files to put into the storage directory of homebridge, by name */
  files?: Record<string, string>;
  /** the number of devices homebridge is to publish, if not all of them */
  publishes?: number;
}

/** every characteristic of the accessories a controller can ask to be notified about */
export const notifying = (accessories: HapAccessory[]): HapCharacteristic[] =>
  accessories.flatMap((accessory) =>
    accessory.services.flatMap((service) => service.characteristics.filter((characteristic) => characteristic.perms?.includes('ev'))),
  );

/** starts a homebridge for the fhem, waits until the devices are published and asks to be notified about every characteristic that allows it */
async function startWorldFor<Fhem extends FhemUnderTest>(
  started: Fhem,
  devices: { name: string; attributes?: Record<string, string | undefined> }[],
  options: Omit<WorldOptions, 'room'>,
): Promise<World & { fhem: Fhem }> {
  // a command that does not arrive is best explained by the log of homebridge
  const explained =
    <Arguments extends unknown[]>(wait: (...expected: Arguments) => Promise<void>) =>
    (...expected: Arguments) =>
      wait(...expected).catch((error: unknown) => {
        throw new Error(`${String(error)}.${said(homebridge)}`);
      });
  const fhem: Fhem = { ...started, wasSet: explained((...expected: Parameters<FhemUnderTest['wasSet']>) => started.wasSet(...expected)) };
  if ('wasTold' in started) {
    const standIn = started as unknown as StandIn;
    Object.assign(fhem, { wasTold: explained((command: string) => standIn.wasTold(command)) });
  }

  const homebridge = await startHomebridge({ ...fhem.platformConfig, ...options.platform }, options.files);
  await published(homebridge, options.publishes ?? devices.length);
  await quiet(homebridge);
  const accessories = await homebridge.accessoriesAsRead();
  await homebridge.subscribe(notifying(accessories));

  // HomeKit is told the siriName of a device as the name of its accessory, or its alias, or the name it has in fhem
  const nameOf = (device: string) => {
    const attributes = devices.find((candidate) => candidate.name === device)?.attributes;
    return attributes?.siriName ?? attributes?.alias ?? device;
  };
  return { ...worldOf(fhem, homebridge, accessories, nameOf), fhem };
}

/**
 * Starts a fhem with the dummy devices, the real one if the environment names one, and a
 * homebridge that publishes them.
 */
export async function startWorld(devices: DummyDevice[], options: WorldOptions): Promise<World> {
  return startWorldFor(await startFhemWith(devices, options.room), devices, options);
}

/**
 * Starts the stand-in with devices exactly as given, and a homebridge that publishes them. For
 * devices a real fhem can not have without their hardware, and for what a real fhem can not be
 * made to do from here.
 */
export async function startStandInWorld(
  devices: FhemDevice[],
  options: Omit<WorldOptions, 'room'> & { fhem?: FakeFhemOptions } = {},
): Promise<World & { fhem: StandIn }> {
  return startWorldFor(
    await startStandIn(devices, options.fhem),
    devices.map((device) => ({ name: device.Internals.NAME, attributes: device.Attributes })),
    options,
  );
}
