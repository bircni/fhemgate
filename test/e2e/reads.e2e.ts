// what HomeKit is answered when it reads a characteristic the plugin asks fhem for, and fhem
// takes its time. the stand-in is made to hold its answers back, so these tests do not run
// against a real fhem. reads that are answered from what the plugin has seen are in
// mappings.e2e.ts and refresh.e2e.ts.
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { asJsonlist2, realFhemUrl, type StandIn } from './fhem.ts';
import { eventually, startStandInWorld, type World } from './world.ts';

/** the status HAP answers a read with that took too long */
const OPERATION_TIMED_OUT = -70408;

describe.skipIf(realFhemUrl !== undefined)('a read of a characteristic that fhem is asked for', () => {
  let world: World & { fhem: StandIn };

  const temperature = (device: string) => world.named(device, 'TemperatureSensor', 'CurrentTemperature');

  /** the lines of the log of homebridge that match */
  const logged = (pattern: RegExp) =>
    world.homebridge
      .output()
      .split('\n')
      .filter((line) => pattern.test(line));

  /** the reading changes in fhem without an event, as one that the long poll missed */
  const changeSilently = (device: string, reading: string, value: string) => {
    const found = world.fhem.fake.options.devices?.find((candidate) => candidate.Internals.NAME === device);
    if (!found) {
      throw new Error(`there is no device ${device}`);
    }
    found.Readings[reading] = { Value: value, Time: '2026-08-16 12:00:00' };
  };

  /** fhem takes the questions for the readings of the device and does not answer them until it is released */
  const hold = (device: string) => {
    world.fhem.fake.options.holds = (cmd) => cmd.startsWith(`{ReadingsVal("${device}"`);
  };

  const release = () => {
    world.fhem.fake.options.holds = undefined;
    world.fhem.fake.release();
  };

  const asked = () => eventually('fhem to be asked', () => (world.fhem.fake.held() ? true : undefined), world.homebridge);

  beforeAll(async () => {
    world = await startStandInWorld([
      // not cached: fhem is asked with every read
      asJsonlist2({
        name: 'e2e_r_asked',
        readings: { state: 'ok', temp: '15' },
        attributes: { genericDeviceType: 'thermometer', homebridgeMapping: 'CurrentTemperature=temp,nocache=true' },
      }),
      asJsonlist2({
        name: 'e2e_r_quick',
        readings: { state: 'ok', temp: '15' },
        attributes: { genericDeviceType: 'thermometer', homebridgeMapping: 'CurrentTemperature=temp,nocache=true' },
      }),
      // the reading is not there when homebridge starts, so the plugin has never seen a value
      asJsonlist2({
        name: 'e2e_r_unseen',
        readings: { state: 'ok' },
        attributes: { genericDeviceType: 'thermometer', homebridgeMapping: 'CurrentTemperature=later' },
      }),
    ]);
  });

  afterAll(async () => {
    release();
    await world.close();
  });

  it('is answered with what fhem says when it answers within two seconds', async () => {
    changeSilently('e2e_r_quick', 'temp', '16.5');
    hold('e2e_r_quick');

    const started = Date.now();
    const read = world.homebridge.answer(temperature('e2e_r_quick'));
    await asked();
    release();

    expect(await read).toEqual({ value: 16.5 });
    expect(Date.now() - started).toBeLessThan(1900);
    expect(logged(/no answer from fhem for e2e_r_quick-temp/)).toEqual([]);
  });

  it('is answered with the last value after two seconds without an answer, and HomeKit is told the answer when it comes', async () => {
    const target = temperature('e2e_r_asked');
    changeSilently('e2e_r_asked', 'temp', '17');
    hold('e2e_r_asked');

    const started = Date.now();
    expect(await world.homebridge.answer(target)).toEqual({ value: 15 });
    const waited = Date.now() - started;

    expect(waited).toBeGreaterThanOrEqual(1950);
    // well before homebridge calls the plugin slow, which it does after three seconds
    expect(waited).toBeLessThan(2900);
    expect(logged(/query: no answer from fhem for e2e_r_asked-temp within 2 seconds, answering with the last value/)).toHaveLength(1);
    expect(logged(/This plugin slows down Homebridge/)).toEqual([]);

    await world.notifies(target, 17, () => {
      release();
      return Promise.resolve();
    });
    expect(await world.homebridge.read(target)).toBe(17);
  });

  it('is answered with an error after two seconds when there never was a value, and HomeKit is told the answer when it comes', async () => {
    const target = temperature('e2e_r_unseen');
    changeSilently('e2e_r_unseen', 'later', '21.5');
    hold('e2e_r_unseen');

    const started = Date.now();
    expect(await world.homebridge.answer(target)).toEqual({ status: OPERATION_TIMED_OUT });
    const waited = Date.now() - started;

    expect(waited).toBeGreaterThanOrEqual(1950);
    expect(waited).toBeLessThan(2900);
    expect(logged(/query: no answer from fhem for e2e_r_unseen-later within 2 seconds$/)).toHaveLength(1);

    await world.notifies(target, 21.5, () => {
      release();
      return Promise.resolve();
    });
    expect(await world.homebridge.answer(target)).toEqual({ value: 21.5 });
  });
});
