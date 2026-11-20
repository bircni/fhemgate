// how the plugin keeps its connection to fhem: a fhem that is not there yet, one that goes away
// and comes back, events that arrive in pieces, and commands with characters that mean
// something in a url. the stand-in is made to do all of that, so these tests do not run against
// a real fhem. that the long poll is opened again after fhem ended it is in scenarios.e2e.ts.
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { asJsonlist2, realFhemUrl, startStandIn, type StandIn } from './fhem.ts';
import { freePort, hapType, startHomebridge, type Homebridge } from './homebridge.ts';
import { eventually, published, startStandInWorld, type World } from './world.ts';

const lamp = (name: string, state = 'off') => asJsonlist2({ name, setList: 'on off', readings: { state } });

/** the lines of the log of a homebridge that match */
const logged = (homebridge: Homebridge, pattern: RegExp) =>
  homebridge
    .output()
    .split('\n')
    .filter((line) => pattern.test(line));

const says = (homebridge: Homebridge, pattern: RegExp) =>
  eventually(`homebridge to log ${String(pattern)}`, () => (logged(homebridge, pattern).length ? true : undefined), homebridge, 60_000);

/** one event as fhem sends it down the long poll */
const event = (informId: string, value: string) => `${JSON.stringify([informId, value, `<div>${value}</div>`])}\n`;

describe.skipIf(realFhemUrl !== undefined)('a fhem that can not be reached when homebridge starts', () => {
  const stops: (() => Promise<void>)[] = [];

  // the second of these two takes half a minute, so its homebridge is started ahead of the tests
  let deadPort: number;
  let latePort: number;
  let patient: Homebridge;

  beforeAll(async () => {
    deadPort = await freePort();
    latePort = await freePort();
    patient = await startHomebridge([
      { server: '127.0.0.1', port: deadPort },
      { server: '127.0.0.1', port: latePort, neverTimeout: true },
    ]);
    stops.push(() => patient.stop());
  });

  afterAll(async () => {
    for (const stop of stops) {
      await stop();
    }
  });

  it('is tried again, and its devices are published once it is there', async () => {
    const port = await freePort();
    const homebridge = await startHomebridge({ server: '127.0.0.1', port });
    stops.push(() => homebridge.stop());

    await says(homebridge, new RegExp(`longpoll error: Error: connect ECONNREFUSED 127\\.0\\.0\\.1:${port}, retry in: 3000msec`));
    await expect(homebridge.accessories()).rejects.toThrow('fetch failed');

    const fhem = await startStandIn([lamp('e2e_c_late')], { port });
    stops.push(() => fhem.close());
    const accessories = await published(homebridge);

    expect(accessories.map((accessory) => accessory.name)).toEqual(['e2e_c_late']);
    expect(fhem.fake.streams).toHaveLength(1);
  });

  it('is given up after the fourth failed attempt, unless the platform is told never to', async () => {
    await says(patient, new RegExp(`ECONNREFUSED 127\\.0\\.0\\.1:${deadPort}, retrys exhausted`));
    // three, six and nine seconds were waited before
    expect(logged(patient, new RegExp(`:${deadPort}, retry in: `)).map((line) => line.replace(/^.*retry in: /, ''))).toEqual([
      '3000msec',
      '6000msec',
      '9000msec',
    ]);

    await says(patient, new RegExp(`ECONNREFUSED 127\\.0\\.0\\.1:${latePort}, retry in: 12000msec`));
    expect(logged(patient, new RegExp(`:${latePort}, retrys exhausted`))).toEqual([]);

    // homebridge still waits for the platform that does not give up
    await expect(patient.accessories()).rejects.toThrow('fetch failed');

    const fhem = await startStandIn([lamp('e2e_c_patient')], { port: latePort });
    stops.push(() => fhem.close());
    const accessories = await published(patient);

    expect(accessories.map((accessory) => accessory.name)).toEqual(['e2e_c_patient']);
  });
});

describe.skipIf(realFhemUrl !== undefined)('a fhem that homebridge is connected to', () => {
  let world: World & { fhem: StandIn };
  /** the fhem that takes the place of the first one */
  let restarted: StandIn | undefined;

  const on = (device: string) => world.characteristic(device, hapType.Switch, hapType.On);
  const pause = () => new Promise((resolve) => setTimeout(resolve, 100));

  beforeAll(async () => {
    world = await startStandInWorld([
      lamp('e2e_c_lamp'),
      lamp('e2e_c_other'),
      // the JSON form of the mapping takes any character in a command
      asJsonlist2({
        name: 'e2e_c_chars',
        setList: 'on off',
        readings: { state: 'off' },
        attributes: {
          genericDeviceType: 'switch',
          homebridgeMapping: JSON.stringify({ On: { reading: 'state', cmdOn: 'on;set e2e_c_other on', cmdOff: 'text a&b#c' } }),
        },
      }),
      asJsonlist2({
        name: 'e2e_c_words',
        setList: 'on off',
        readings: { state: 'off' },
        attributes: { homebridgeMapping: 'On=cmdOn=farbe+grün+50%,cmdOff=aus' },
      }),
    ]);
  });

  afterAll(async () => {
    await world.close();
    await restarted?.close();
  });

  describe('a command', () => {
    it('reaches fhem with its blanks, umlauts and percent signs', async () => {
      await world.homebridge.write(on('e2e_c_words'), true);

      await world.fhem.wasSet('e2e_c_words', 'farbe grün 50%', 'state', 'farbe grün 50%');
    });

    it('with a semicolon reaches fhem as two commands', async () => {
      await world.notifies(on('e2e_c_other'), 1, () => world.homebridge.write(on('e2e_c_chars'), true));

      expect(world.fhem.fake.commands).toContain('set e2e_c_chars on;set e2e_c_other on');
    });

    it('is cut short at an ampersand, and loses the csrf token behind a hash sign, so that fhem refuses it', async () => {
      await world.homebridge.write(on('e2e_c_chars'), false);

      await world.fhem.wasTold('set e2e_c_chars text a');
      expect(world.fhem.fake.requests.at(-1)?.url).toBe('/fhem?cmd=set%20e2e_c_chars%20text%20a&b');
      await says(world.homebridge, / {2}400: Bad Request/);
    });
  });

  describe('an event', () => {
    it('that arrives in two pieces is put together', async () => {
      const line = event('e2e_c_lamp-state', 'on');

      await world.notifies(on('e2e_c_lamp'), 1, async () => {
        world.fhem.fake.send(line.slice(0, 12));
        await pause();
        world.fhem.fake.send(line.slice(12));
      });
    });

    it('is taken apart from the others that arrive in the same piece', async () => {
      const before = world.homebridge.notifications().length;

      await world.notifies(on('e2e_c_other'), 0, () => {
        world.fhem.fake.send(event('e2e_c_lamp-state', 'off') + event('e2e_c_other-state', 'off') + event('e2e_c_lamp-state', 'on').slice(0, 20));
        return Promise.resolve();
      });

      // the third event is not complete yet
      const told = world.homebridge
        .notifications()
        .slice(before)
        .filter((notification) => notification.iid === on('e2e_c_lamp').iid && notification.aid === on('e2e_c_lamp').aid);
      expect(told.map((notification) => Number(notification.value))).toEqual([0]);

      await world.notifies(on('e2e_c_lamp'), 1, () => {
        world.fhem.fake.send(event('e2e_c_lamp-state', 'on').slice(20));
        return Promise.resolve();
      });
    });

    it('is also read in the form fhem sends without JSON', async () => {
      await world.notifies(on('e2e_c_lamp'), 0, () => {
        world.fhem.fake.send('e2e_c_lamp-state<<off<<<div>off</div>\n');
        return Promise.resolve();
      });
    });

    it('is skipped when it is no change of a reading, or can not be read', async () => {
      await world.notifies(on('e2e_c_lamp'), 1, () => {
        world.fhem.fake.send(
          // the time of a reading, an event for the web frontend, the echo of a set command, a broken line and an empty one
          event('e2e_c_lamp-state-ts', '2026-08-16 12:00:00') +
            event('#FHEMWEB:WEB', 'location.reload()') +
            event('e2e_c_other-state', 'set-on') +
            '[broken\n' +
            '\n' +
            event('e2e_c_lamp-state', 'on'),
        );
        return Promise.resolve();
      });

      expect(logged(world.homebridge, /longpoll JSON\.parse: /)).toHaveLength(1);
      expect(await world.homebridge.read(on('e2e_c_other'))).toBe(0);
    });
  });

  describe('when fhem restarts', () => {
    it('opens the long poll again, asks for what it missed, and goes on with events and commands', async () => {
      const { port } = world.fhem.fake;
      await world.fhem.close();
      await says(world.homebridge, /longpoll (error: .*, retry in: 3000msec|ended, reconnect in: )/);

      const again = await startStandIn([lamp('e2e_c_lamp', 'on'), lamp('e2e_c_other')], { port });
      restarted = again;
      await eventually('the plugin to open the long poll again', () => (again.fake.openStreams() ? true : undefined), world.homebridge, 60_000);

      // from the time of the last event it has seen
      expect(again.fake.streams[0]).toMatch(/;since=\d+(\.\d+)?;fmt=JSON/);
      // the attributes are looked at again
      await again.wasTold('{AttrVal("global","userattr","")}');

      await world.notifies(on('e2e_c_lamp'), 0, () => again.change('e2e_c_lamp', 'state', 'off'));
      await world.homebridge.write(on('e2e_c_other'), true);
      await again.wasSet('e2e_c_other', 'on', 'state', 'on');
    });
  });
});
