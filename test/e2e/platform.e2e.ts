// the options of the FHEM platform in the config.json of homebridge, and what the platform does
// when it starts. the tests look at what the stand-in is asked, so they do not run against a
// real fhem. the filter option is also in scenarios.e2e.ts, which does.
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { afterAll, afterEach, beforeAll, describe, expect, inject, it } from 'vitest';
import { asJsonlist2, realFhemUrl, startStandIn, type StandIn } from './fhem.ts';
import { hapType, startHomebridge, type HapAccessory, type Homebridge } from './homebridge.ts';
import { eventually, notifying, published, servicesByName, worldOf, type World } from './world.ts';

const lamp = (name: string, room: string) => asJsonlist2({ name, setList: 'on off', readings: { state: 'off' } }, room);

const { version } = JSON.parse(readFileSync(join(import.meta.dirname, '..', '..', 'package.json'), 'utf8')) as { version: string };

/** the lines of the log of a homebridge that match */
const logged = (homebridge: Homebridge, pattern: RegExp) =>
  homebridge
    .output()
    .split('\n')
    .filter((line) => pattern.test(line));

describe.skipIf(realFhemUrl !== undefined)('several FHEM platforms in one homebridge', () => {
  const basic = `Basic ${Buffer.from('homebridge:secret').toString('base64')}`;

  /** asks for user and password, hands out a csrf token and has a siri device */
  let first: StandIn;
  /** a FHEMWEB without csrf token */
  let second: StandIn;
  let third: StandIn;
  let homebridge: Homebridge;
  let accessories: HapAccessory[];
  let atFirst: World;
  let atSecond: World;

  beforeAll(async () => {
    first = await startStandIn(
      [
        lamp('e2e_p_first', 'a'),
        lamp('e2e_p_cellar', 'cellar'),
        lamp('e2e_p_both', 'a,b'),
        asJsonlist2(
          {
            name: 'e2e_p_level',
            setList: 'on off',
            readings: { state: 'on', level: '128' },
            attributes: { genericDeviceType: 'light', homebridgeMapping: 'Brightness=level,reading2homekit=half' },
          },
          'a',
        ),
        { ...lamp('siri', 'cellar'), Internals: { NAME: 'siri', TYPE: 'siri' } },
      ],
      { auth: { user: 'homebridge', pass: 'secret' } },
    );
    second = await startStandIn([lamp('e2e_p_second', 'b'), lamp('e2e_p_both', 'a,b')], { csrfToken: undefined });
    third = await startStandIn([lamp('e2e_p_alexa', 'c')], { auth: { user: 'homebridge', pass: 'secret' } });

    // a file with functions outside the storage directory of homebridge, named with its whole path
    const functions = join(mkdtempSync(join(inject('e2eDirectory'), 'functions-')), 'functions.cjs');
    writeFileSync(functions, 'module.exports = { half: (mapping, orig) => Math.round(Number(orig) / 2) };');

    homebridge = await startHomebridge([
      {
        ...first.platformConfig,
        webname: 'custom',
        auth: { user: 'homebridge', pass: 'secret' },
        filter: 'room=a',
        scope: 'alexa,siri',
        jsFunctions: functions,
      },
      { ...second.platformConfig, filter: 'room=b', neverTimeout: true, jsFunctions: 'missing.cjs' },
      // user and password under their other names, and a scope without siri
      { ...third.platformConfig, auth: { username: 'homebridge', password: 'secret' }, scope: 'alexa' },
      // no server
      {},
    ]);
    accessories = await published(homebridge, 4);
    await homebridge.subscribe(notifying(accessories));
    atFirst = worldOf(first, homebridge, accessories, (device) => device);
    atSecond = worldOf(second, homebridge, accessories, (device) => device);
  });

  afterAll(async () => {
    await homebridge.stop();
    await Promise.all([first.close(), second.close(), third.close()]);
  });

  it('publishes the devices of all of them on the one bridge, a device both have only once', () => {
    expect(accessories.map((accessory) => accessory.name).sort()).toEqual(['e2e_p_both', 'e2e_p_first', 'e2e_p_level', 'e2e_p_second']);
    expect(logged(homebridge, /e2e_p_both is already published/)).toHaveLength(1);
    expect(logged(homebridge, /no accessory created for e2e_p_both \(dummy\)/)).toHaveLength(1);
  });

  it('starts although one platform has no server', () => {
    expect(logged(homebridge, /incomplete configuration/)).toHaveLength(1);
  });

  it('asks each fhem for the devices of its filter', () => {
    expect(first.fake.commands).toContain('jsonlist2 room=a');
    expect(second.fake.commands).toContain('jsonlist2 room=b');
    // without a filter
    expect(third.fake.commands).toContain('jsonlist2');
  });

  it('asks under the webname of the platform, fhem if it has none', () => {
    expect(first.fake.requests.every((request) => request.url.startsWith('/custom?'))).toBe(true);
    expect(second.fake.requests.every((request) => request.url.startsWith('/fhem?'))).toBe(true);
  });

  it('sends user and password with every request, the long poll included', () => {
    expect(first.fake.streams).toHaveLength(1);
    expect(first.fake.requests.map((request) => request.authorization)).toEqual(first.fake.requests.map(() => basic));
    expect(third.fake.requests.map((request) => request.authorization)).toEqual(third.fake.requests.map(() => basic));
    expect(second.fake.requests.map((request) => request.authorization)).toEqual(second.fake.requests.map(() => undefined));
  });

  it('sends the csrf token of a FHEMWEB that has one with every command, and none to one that has none', () => {
    const commands = (fhem: StandIn) => fhem.fake.requests.filter((request) => request.url.includes('cmd='));

    expect(commands(first).length).toBeGreaterThan(0);
    expect(commands(first).every((request) => request.url.includes('&fwcsrf=csrf_fake_token'))).toBe(true);
    expect(commands(second).length).toBeGreaterThan(0);
    expect(commands(second).some((request) => request.url.includes('fwcsrf'))).toBe(false);
  });

  it('leaves out the devices of a platform whose scope does not include siri', () => {
    expect(logged(homebridge, /ignoring e2e-p-alexa for siri/)).toHaveLength(1);
    expect(accessories.map((accessory) => accessory.name)).not.toContain('e2e_p_alexa');
  });

  it('loads the jsFunctions file by its whole path, and goes on without a file it can not find', () => {
    expect(Number(atFirst.characteristic('e2e_p_level', hapType.Lightbulb, hapType.Brightness).value)).toBe(64);
    expect(logged(homebridge, /jsFunctions: Error: Cannot find module .*missing\.cjs/)).toHaveLength(1);
  });

  it('tells the siri device of a fhem which version it is', async () => {
    await first.wasTold(`{$defs{siri}->{"homebridge-fhem version"} = "${version}"}`);
    expect(logged(homebridge, /siri device is siri/)).toHaveLength(1);
    // the other two have none
    expect(logged(homebridge, /no siri device found\. please define it\./)).toHaveLength(2);
  });

  it('leaves the attributes of a fhem alone that knows them', () => {
    expect(first.fake.commands.filter((command) => command.includes('addToAttrList'))).toEqual([]);
  });

  it('sends what HomeKit writes to the fhem of the device', async () => {
    await homebridge.write(atFirst.characteristic('e2e_p_first', hapType.Switch, hapType.On), true);
    await first.wasSet('e2e_p_first', 'on', 'state', 'on');

    await homebridge.write(atSecond.characteristic('e2e_p_second', hapType.Switch, hapType.On), true);
    await second.wasSet('e2e_p_second', 'on', 'state', 'on');

    expect(second.fake.commands).not.toContain('set e2e_p_first on');
    expect(first.fake.commands).not.toContain('set e2e_p_second on');
  });

  it('tells HomeKit what changes in either fhem', async () => {
    await atFirst.notifies(atFirst.characteristic('e2e_p_first', hapType.Switch, hapType.On), 0, () => first.change('e2e_p_first', 'state', 'off'));
    await atSecond.notifies(atSecond.characteristic('e2e_p_second', hapType.Switch, hapType.On), 0, () => second.change('e2e_p_second', 'state', 'off'));
  });
});

describe.skipIf(realFhemUrl !== undefined)('a platform', () => {
  const started: { stop(): Promise<void> }[] = [];

  /** a stand-in and a homebridge for it, both stopped after the test */
  async function start(
    devices: Parameters<typeof startStandIn>[0],
    fhemOptions: Parameters<typeof startStandIn>[1] = {},
    platform: Record<string, unknown> = {},
  ): Promise<{ fhem: StandIn; homebridge: Homebridge }> {
    const fhem = await startStandIn(devices, fhemOptions);
    const homebridge = await startHomebridge({ ...fhem.platformConfig, ...platform });
    started.push({ stop: () => homebridge.stop() }, { stop: () => fhem.close() });
    return { fhem, homebridge };
  }

  const names = (accessories: HapAccessory[]) => accessories.map((accessory) => accessory.name).sort();

  const says = (homebridge: Homebridge, pattern: RegExp) =>
    eventually(`homebridge to log ${String(pattern)}`, () => (logged(homebridge, pattern).length ? true : undefined), homebridge, 60_000);

  afterEach(async () => {
    for (const each of started.splice(0)) {
      await each.stop();
    }
  });

  it('takes an ssl that is neither true nor false for false, says so and goes on', async () => {
    const { fhem, homebridge } = await start([lamp('e2e_p_lamp', 'a')], {}, { ssl: 'yes' });

    expect(names(await published(homebridge))).toEqual(['e2e_p_lamp']);
    expect(logged(homebridge, /config: value for ssl has to be boolean\. taking "yes" as false\./)).toHaveLength(1);
    // asked without TLS, which is all the stand-in speaks here
    expect(fhem.fake.streams).toHaveLength(1);
  });

  it('asks over https when ssl is true', async () => {
    const { fhem, homebridge } = await start([lamp('e2e_p_lamp', 'a')], {}, { ssl: true });

    await says(homebridge, new RegExp(`starting longpoll: https://127\\.0\\.0\\.1:${fhem.fake.port}/fhem\\?`));
    // the stand-in does not speak TLS, so that is as far as it gets
    await says(homebridge, /longpoll error: /);
    expect(fhem.fake.requests).toEqual([]);
  });

  it('creates the attributes fhem does not know yet, says that homebridge is to be restarted for them, and goes on', async () => {
    const { fhem, homebridge } = await start([lamp('e2e_p_lamp', 'a')], { userattr: 'siriName' });

    expect(names(await published(homebridge))).toEqual(['e2e_p_lamp']);
    expect(fhem.fake.commands).toContain('{ addToAttrList( "homebridgeMapping:textField-long" ) }');
    expect(fhem.fake.commands).toContain(
      '{addToAttrList( "genericDeviceType:security,ignore,switch,outlet,light,blind,thermometer,thermostat,contact,garage,window,lock" ) }',
    );
    await says(homebridge, /genericDeviceType attribute was not known to fhem and was created\. restart homebridge after giving it to devices\./);
    expect(logged(homebridge, /homebridgeMapping attribute created\./)).toHaveLength(1);
    // homebridge still answers
    expect(names(await homebridge.accessories())).toEqual(['e2e_p_lamp']);
  });

  it('asks fhem for the devices again when it does not list them, and hands homebridge no empty list meanwhile', async () => {
    // refused once, then answered with something that is no list of devices
    const answers = [
      { status: 500, body: 'no' },
      { status: 200, body: '<html>busy</html>' },
    ];
    const { homebridge } = await start([lamp('e2e_p_lamp', 'a')], { answer: (cmd) => (cmd === 'jsonlist2' ? answers.shift() : undefined) });

    await says(homebridge, /fetching the devices failed for the 1\. time, trying again in: 3000msec/);
    expect(logged(homebridge, / {2}500: Internal Server Error/)).toHaveLength(1);
    // homebridge still waits for the platform
    await expect(homebridge.accessories()).rejects.toThrow('fetch failed');

    await says(homebridge, /fetching the devices failed for the 2\. time, trying again in: 6000msec/);
    expect(logged(homebridge, / {2}the answer is no list of devices/)).toHaveLength(1);

    expect(names(await published(homebridge))).toEqual(['e2e_p_lamp']);
  });

  it.each([
    ['lacks the password FHEMWEB asks for', { auth: { user: 'homebridge', pass: 'secret' } }, '401 Unauthorized'],
    ['is refused by FHEMWEB', { forbidden: true }, '403 Forbidden'],
  ])('reports a long poll that %s as failed authentication, waits longer every time and asks nothing else', async (_what, fhemOptions, status) => {
    const { fhem, homebridge } = await start([lamp('e2e_p_lamp', 'a')], fhemOptions);
    const refused = (pause: number) =>
      new RegExp(
        `longpoll refused by fhem with ${status}: authentication failed\\. check user and password \\(auth\\) of the platform\\. retry in: ${pause}msec`,
      );

    await says(homebridge, refused(3000));
    await says(homebridge, refused(6000));

    expect(logged(homebridge, /longpoll ended, reconnect in: /)).toEqual([]);
    expect(fhem.fake.requests.every((request) => request.url.includes('inform='))).toBe(true);
    expect(fhem.fake.streams).toEqual([]);
  });

  it('takes a scope that is a list', async () => {
    const { homebridge } = await start([lamp('e2e_p_lamp', 'a')], {}, { scope: ['alexa', 'siri'] });

    expect(names(await published(homebridge))).toEqual(['e2e_p_lamp']);
  });

  it('knows the battery service by the name it had before HAP-NodeJS 2, which the README uses', async () => {
    const { homebridge } = await start([
      lamp('e2e_p_lamp', 'a'),
      asJsonlist2({
        name: 'e2e_p_battery',
        setList: 'on off',
        readings: { state: 'on', level: '80' },
        attributes: { genericDeviceType: 'switch', homebridgeMapping: 'On=state,cmdOn=on,cmdOff=off BatteryService#BatteryLevel=level' },
      }),
    ]);

    expect(servicesByName(await published(homebridge, 2))).toEqual({
      e2e_p_battery: [hapType.Switch, hapType.BatteryService],
      e2e_p_lamp: [hapType.Switch],
    });
  });

  it('skips a mapping that names a service HomeKit does not know, and publishes the rest of the device and the others', async () => {
    const { homebridge } = await start([
      lamp('e2e_p_lamp', 'a'),
      asJsonlist2({
        name: 'e2e_p_unknown',
        setList: 'on off',
        readings: { state: 'on', level: '80' },
        attributes: { genericDeviceType: 'switch', homebridgeMapping: 'On=state,cmdOn=on,cmdOff=off Akku#BatteryLevel=level' },
      }),
    ]);

    expect(servicesByName(await published(homebridge, 2))).toEqual({ e2e_p_lamp: [hapType.Switch], e2e_p_unknown: [hapType.Switch] });
    expect(logged(homebridge, /e2e-p-unknown: service name Akku unknown/)).toHaveLength(1);
    expect(logged(homebridge, /Cannot add a Service with the same UUID/)).toEqual([]);
  });
});
