// a read of a characteristic is answered from what the plugin has seen, and fhem is asked in
// the background whether that still holds, at most once a minute for a reading. the tests move
// the clock of homebridge on by a minute rather than wait for it to pass.
//
// the readings change in the stand-in without an event, as when the long poll missed one, so
// these tests do not run against a real fhem.
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { asJsonlist2, realFhemUrl, type StandIn } from './fhem.ts';
import type { HapCharacteristic } from './homebridge.ts';
import { eventually, startStandInWorld, type World } from './world.ts';

describe.skipIf(realFhemUrl !== undefined)('a read of a characteristic that is answered from what the plugin has seen', () => {
  let world: World & { fhem: StandIn };

  const thermometer = (name: string) =>
    asJsonlist2({
      name,
      readings: { state: 'ok', temp: '15' },
      attributes: { genericDeviceType: 'thermometer', homebridgeMapping: 'CurrentTemperature=temp' },
    });

  const temperature = (device: string) => world.named(device, 'TemperatureSensor', 'CurrentTemperature');

  /** how often fhem was asked for the reading */
  const asked = (device: string) => world.fhem.fake.commands.filter((command) => command === `{ReadingsVal("${device}","temp","")}`).length;

  /** what HomeKit was told about the characteristic */
  const told = (target: HapCharacteristic) =>
    world.homebridge
      .notifications()
      .filter((notification) => notification.aid === target.aid && notification.iid === target.iid)
      .map((notification) => Number(notification.value));

  /** the reading changes in fhem without an event. without a value it is deleted. */
  const changeSilently = (device: string, value?: string) => {
    const found = world.fhem.fake.options.devices?.find((candidate) => candidate.Internals.NAME === device);
    if (!found) {
      throw new Error(`there is no device ${device}`);
    }
    if (value === undefined) {
      delete found.Readings.temp;
    } else {
      found.Readings.temp = { Value: value, Time: '2026-08-16 12:00:00' };
    }
  };

  /** long enough for homebridge to take an answer fhem has sent */
  const settled = () => new Promise((resolve) => setTimeout(resolve, 500));

  /** a minute passes since homebridge listed the accessories, which read every characteristic, or since the last minute passed */
  const minuteIsOver = () => world.homebridge.passTime(60_500);

  beforeAll(async () => {
    world = await startStandInWorld([thermometer('e2e_f_missed'), thermometer('e2e_f_event'), thermometer('e2e_f_gone')]);
  });

  afterAll(async () => {
    world.fhem.fake.release();
    await world.close();
  });

  it('does not ask fhem again within a minute, however often HomeKit reads', async () => {
    const target = temperature('e2e_f_missed');
    const before = asked('e2e_f_missed');
    changeSilently('e2e_f_missed', '17');

    for (let read = 0; read < 3; read++) {
      expect(await world.homebridge.read(target)).toBe(15);
    }
    await settled();

    expect(asked('e2e_f_missed')).toBe(before);
    expect(told(target)).toEqual([]);
  });

  it('asks fhem once the minute is over, and tells HomeKit the value the long poll missed', async () => {
    const target = temperature('e2e_f_missed');
    const before = asked('e2e_f_missed');
    await minuteIsOver();

    // the read itself is still answered with what the plugin has seen
    await world.notifies(target, 17, async () => {
      expect(await world.homebridge.read(target)).toBe(15);
    });

    expect(await world.homebridge.read(target)).toBe(17);
    await settled();
    // the second read is within the next minute
    expect(asked('e2e_f_missed')).toBe(before + 1);
    expect(told(target)).toEqual([17]);
  });

  it('keeps the value of an event that arrived while fhem was asked', async () => {
    const target = temperature('e2e_f_event');
    await minuteIsOver();
    world.fhem.fake.options.holds = (cmd) => cmd === '{ReadingsVal("e2e_f_event","temp","")}';

    expect(await world.homebridge.read(target)).toBe(15);
    await eventually('fhem to be asked', () => (world.fhem.fake.held() ? true : undefined), world.homebridge);
    await world.notifies(target, 19, () => world.fhem.change('e2e_f_event', 'temp', '19'));

    // fhem answers with what the reading was when it was asked
    changeSilently('e2e_f_event', '15');
    world.fhem.fake.options.holds = undefined;
    world.fhem.fake.release();
    await settled();

    expect(await world.homebridge.read(target)).toBe(19);
    expect(told(target)).toEqual([19]);
  });

  it('keeps the value when fhem answers that it has no such reading', async () => {
    const target = temperature('e2e_f_gone');
    const before = asked('e2e_f_gone');
    await minuteIsOver();
    changeSilently('e2e_f_gone');

    expect(await world.homebridge.read(target)).toBe(15);
    await eventually('fhem to be asked', () => (asked('e2e_f_gone') === before + 1 ? true : undefined), world.homebridge);
    await settled();

    expect(await world.homebridge.read(target)).toBe(15);
    expect(told(target)).toEqual([]);
  });
});
