// runs every device under test/fixtures/devices through the plugin and records what it makes
// of it. the records are the description of what the plugin does today: a change to one of them
// is a change in behaviour for the people who own such a device.
import { describe, expect, it } from 'vitest';
import { describeIdentity, describeMappings, describeService, eachMapping, groupByResult, outcome } from './support/describe.ts';
import { fixtureDevices, type Fixture } from './support/devices.ts';
import { createWorld, type World } from './support/subject.ts';
import type { Accessory, Mapping } from './support/types.ts';

// what a homebridgeMapping can refer to by name
const jsFunctions = {
  byteToPercent: (_mapping: Mapping, orig: string) => Math.round(Number(orig) / 2.55),
  percentToByte: (_mapping: Mapping, orig: number) => Math.round(orig * 2.55),
  throws: () => {
    throw new Error('boom');
  },
  notANumber: () => NaN,
};

// values fhem could report for a reading
const readings = [
  'on', 'off', 'ON', '0', '1', '2', '3', '20', '50', '99', '100', '254', '1500', '21.5', '-5', '0.35',
  'dim 50', 'dim50%', 'closed', 'open', 'Closed', 'present', 'absent', 'locked', 'ok', 'low', 'A0', '000000',
  'ff8000', '0.4573,0.41', 'set-on', 'set_off', 'true', 'false', 'PLAYING', 'opening', 'up:on', 'auto',
  'manual', 'home', 'TV', 'short', 'motion 7 T: 21.5', '',
];

// a smaller set for the path from a changed reading to the value of the characteristic
const updates = ['on', 'off', '0', '1', '50', '100', '21.5', 'closed', 'open', 'ff8000', ''];

// values homekit could write to a characteristic
const writes = [true, false, 0, 1, 2, 3, 10, 50, 100, 21.5, -90, 90, 359];

function start(fixture: Fixture): { world: World; accessory: Accessory } {
  const world = createWorld({
    jsFunctions,
    respond: (cmd) => (cmd.startsWith('{ReadingsVal(') ? '19.5' : undefined),
  });
  return { world, accessory: world.accessory(fixture.load()) };
}

/** the platform only publishes accessories that got a service */
const isPublished = (accessory: Accessory) => accessory.service_name !== undefined;

function isWritable(mapping: Mapping): boolean {
  return ['cmd', 'cmdOn', 'cmdOff', 'cmds', 'homekit2reading'].some((key) => mapping[key] !== undefined);
}

describe.each(fixtureDevices())('$id', (fixture) => {
  it('is detected', () => {
    const { world, accessory } = start(fixture);

    expect({
      ...describeIdentity(accessory),
      published: isPublished(accessory),
      mappings: isPublished(accessory) ? describeMappings(accessory) : undefined,
      sent: world.sent,
      log: world.log.lines,
    }).toMatchSnapshot();
  });

  it('gets its services', () => {
    const { world, accessory } = start(fixture);
    if (!isPublished(accessory)) {
      return;
    }
    world.log.clear();

    const services = outcome(() => accessory.getServices().map(describeService));

    expect({
      services: JSON.parse(services.startsWith('throws') ? JSON.stringify(services) : services) as unknown,
      displayName: accessory.displayName,
      subscriptions: Object.fromEntries(Object.entries(world.subscriptions).map(([informId, list]) => [informId, list?.length])),
      log: world.log.lines,
    }).toMatchSnapshot();
  });

  it('converts readings', () => {
    const { world, accessory } = start(fixture);
    if (!isPublished(accessory)) {
      return;
    }
    outcome(() => accessory.getServices());

    const converted: Record<string, string[]> = {};
    for (const [label, mapping] of eachMapping(accessory)) {
      converted[label] = groupByResult(readings.map((reading) => [reading, outcome(() => world.toHomekit(mapping, reading))]));
    }

    expect(converted).toMatchSnapshot();
  });

  it('updates characteristics', async () => {
    const { world, accessory } = start(fixture);
    if (!isPublished(accessory)) {
      return;
    }
    outcome(() => accessory.getServices());

    const updated: Record<string, string[]> = {};
    for (const informId of Object.keys(world.subscriptions)) {
      const results: [string, string][] = [];
      for (const value of updates) {
        const thrown = outcome(() => {
          world.update(informId, value);
        });
        // homekit characteristics take a new value asynchronously
        await new Promise((resolve) => setImmediate(resolve));
        const values = (world.subscriptions[informId] ?? []).map(({ characteristic }) => {
          return `${characteristic?.displayName ?? '-'}=${JSON.stringify(characteristic?.value)}`;
        });
        results.push([value, [thrown === 'undefined' ? '' : thrown, ...values].filter(Boolean).join(' ')]);
      }
      updated[informId] = groupByResult(results);
    }

    expect(updated).toMatchSnapshot();
  });

  it('sends commands', () => {
    const { world, accessory } = start(fixture);
    if (!isPublished(accessory)) {
      return;
    }
    outcome(() => accessory.getServices());

    const commands: Record<string, string[]> = {};
    for (const [label, mapping] of eachMapping(accessory)) {
      commands[label] = groupByResult((isWritable(mapping) ? writes : [1]).map((value) => {
        world.sent.length = 0;
        world.log.clear();
        const thrown = outcome(() => {
          accessory.command(mapping, value);
        });
        const errors = world.log.errors();
        return [value, [thrown === 'undefined' ? '' : thrown, ...world.sent, ...errors].filter(Boolean).join(' | ') || '(nothing)'];
      }));
    }

    expect(commands).toMatchSnapshot();
  });
});
