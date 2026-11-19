// every device fixture, served by the stand-in fhem to a real homebridge: does homebridge
// publish for each of them the services and characteristics the plugin builds?
//
// the other suites look at what the plugin builds. this one looks at what is left of it once
// homebridge and HAP-NodeJS have taken it, read back the way a HomeKit controller reads it.
import { afterAll, describe, expect, it } from 'vitest';
import { fixtureDevices } from '../support/devices.ts';
import { createWorld, hap } from '../support/subject.ts';
import type { FhemDevice } from '../support/types.ts';
import { realFhemUrl, startFakeFhemWith, type FhemUnderTest } from './fhem.ts';
import { hapType, shortType, startHomebridge, type Homebridge } from './homebridge.ts';

// the functions the fixtures name in their mappings, as test/devices.test.ts defines them.
// homebridge gets them as a file.
const functions = {
  byteToPercent: (_mapping: unknown, orig: string) => Math.round(Number(orig) / 2.55),
  percentToByte: (_mapping: unknown, orig: number) => Math.round(orig * 2.55),
  throws: () => {
    throw new Error('boom');
  },
  notANumber: () => NaN,
};
const jsFunctions = `module.exports = {${Object.entries(functions)
  .map(([name, body]) => `${name}: ${body.toString()}`)
  .join(',\n')}};`;

// the mappings of this fixture ask for a second service of a type without a subtype, which
// homebridge would refuse. it is among the fixtures above and has a test of its own below.
const SKIPS_A_MAPPING = 'mapping/linked-services';

/** the fixtures as fhem lists them */
function devices(only?: string): FhemDevice[] {
  return fixtureDevices()
    .filter((fixture) => only === undefined || fixture.id === only)
    .map((fixture) => {
      const device = fixture.load();
      return { Name: device.Internals.NAME, ...device };
    });
}

/** what the plugin builds for the devices: by accessory name, the services other than the information, as `type: characteristic types` */
function expected(group: FhemDevice[]): Record<string, string[]> {
  const services: Record<string, string[]> = {};
  for (const device of group) {
    const world = createWorld({ jsFunctions: functions });
    const accessory = world.accessory(structuredClone(device));
    if (accessory.service_name === undefined || accessory.siriName === undefined) {
      continue;
    }
    // HomeKit is told the siriName as the name of the accessory
    services[accessory.siriName] = accessory
      .getServices()
      .filter((service) => service instanceof hap.Service && service.UUID !== hap.Service.AccessoryInformation.UUID)
      .map(
        (service) =>
          `${shortType(service.UUID)}: ${service.characteristics
            .map((characteristic) => shortType(characteristic.UUID))
            .sort()
            .join(' ')}`,
      )
      .sort();
  }
  return services;
}

const all = devices();
// a bridge takes 149 accessories at most
const groups = [all.slice(0, Math.ceil(all.length / 2)), all.slice(Math.ceil(all.length / 2))];

describe.skipIf(realFhemUrl !== undefined).each(groups.map((group, index) => ({ group, part: index + 1 })))('device fixtures, part $part', ({ group }) => {
  let fhem: FhemUnderTest | undefined;
  let homebridge: Homebridge | undefined;

  afterAll(async () => {
    await homebridge?.stop();
    await fhem?.close();
  });

  it('are published by homebridge with the services and characteristics the plugin builds', async () => {
    const built = expected(group);
    fhem = await startFakeFhemWith(group);
    homebridge = await startHomebridge({ ...fhem.platformConfig, jsFunctions: 'functions.cjs' }, { 'functions.cjs': jsFunctions });

    const deadline = Date.now() + 60_000;
    let published: Record<string, string[]> = {};
    while (Object.keys(published).length < Object.keys(built).length && Date.now() < deadline) {
      await new Promise((resolve) => setTimeout(resolve, 250));
      const accessories = await homebridge.accessories().catch(() => []);
      published = Object.fromEntries(
        accessories.map((accessory) => [
          accessory.name,
          accessory.services
            .filter((service) => service.type !== hapType.AccessoryInformation)
            .map(
              (service) =>
                `${service.type}: ${service.characteristics
                  .map((characteristic) => characteristic.type)
                  .sort()
                  .join(' ')}`,
            )
            .sort(),
        ]),
      );
    }

    // with the real fakegato-history, which only homebridge has here, the device with a history
    // gets the history service of Eve next to its contact sensor
    if (published.history) {
      // eslint-disable-next-line vitest/no-conditional-expect -- only one of the two halves has this device
      expect(published.history.map((service) => service.split(':')[0])).toEqual(['80', 'E863F007-079E-48FF-8F27-9C2605A29F52']);
      published.history = built.history ?? [];
    }

    expect(Object.keys(built).length).toBeGreaterThan(50);
    expect(
      published,
      homebridge
        .output()
        .split('\n')
        .filter((line) => /error|warn/i.test(line))
        .slice(0, 20)
        .join('\n'),
    ).toEqual(built);
  });
});

describe.skipIf(realFhemUrl !== undefined)('a device whose mappings give two services of the same type and subtype', () => {
  let fhem: FhemUnderTest | undefined;
  let homebridge: Homebridge | undefined;

  afterAll(async () => {
    await homebridge?.stop();
    await fhem?.close();
  });

  it('is published without the mapping that asks for it, like the other devices of the platform', async () => {
    const lamp = devices('switch/dummy-on-off');
    fhem = await startFakeFhemWith([...devices(SKIPS_A_MAPPING), ...lamp]);
    homebridge = await startHomebridge(fhem.platformConfig);

    const deadline = Date.now() + 60_000;
    let names: string[] = [];
    while (names.length < 2 && Date.now() < deadline) {
      await new Promise((resolve) => setTimeout(resolve, 250));
      names = (await homebridge.accessories().catch(() => [])).map((accessory) => accessory.name).sort();
    }

    expect(names).toEqual(['Stehlampe Wohnzimmer', 'linked_services']);
    expect(homebridge.output()).not.toContain('Cannot add a Service with the same UUID');
    expect(homebridge.output()).toContain('needs another InputSource service without a subtype. give it a subtype of its own. the mapping is skipped.');
  });
});
