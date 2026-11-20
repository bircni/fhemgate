// how the plugin talks to fhem: the long poll for events, and the commands it sends
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import https from 'node:https';
import type { AddressInfo } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi, type MockInstance } from 'vitest';
import { device } from './support/devices.ts';
import { startFakeFhem, waitFor, type FakeFhem, type FakeFhemOptions } from './support/fhemweb.ts';
import { characteristicOf, serviceOf } from './support/homekit.ts';
import { createWorld, hap, type World, type WorldOptions } from './support/subject.ts';
import { selfSignedCertificate } from './support/tls.ts';
import type { Accessory, Platform, PlatformConfig } from './support/types.ts';

let fhem: FakeFhem;
let world: World;
let exit: MockInstance<typeof process.exit>;

const lamp = () => device({ Internals: { NAME: 'lamp' }, Readings: { state: 'on' }, PossibleSets: 'on off' });

/** starts fhem and a platform connected to it, and waits until the platform has looked at the attributes */
async function connect(options: FakeFhemOptions = {}, config: PlatformConfig = {}, worldOptions: WorldOptions = {}): Promise<Platform> {
  fhem = await startFakeFhem(options);
  world = createWorld(worldOptions);
  const platform = world.platform({ platform: 'FHEM', server: '127.0.0.1', port: fhem.port, ...config });
  await waitFor(() => fhem.commands.includes('jsonlist2 TYPE=siri'), 'the platform to connect');
  await waitFor(() => world.log.lines.some((line) => line.includes('siri device')), 'the answer about the siri device');
  return platform;
}

function accessoriesOf(platform: Platform): Promise<Accessory[]> {
  return new Promise((resolve) => {
    platform.accessories(resolve);
  });
}

async function firstAccessoryOf(platform: Platform): Promise<Accessory> {
  const [accessory] = await accessoriesOf(platform);
  if (!accessory) {
    throw new Error('the platform has no accessory');
  }
  return accessory;
}

const baseUrl = () => `http://127.0.0.1:${fhem.port}/fhem`;
const withoutPort = (text: string) => text.replaceAll(String(fhem.port), 'PORT').replace(/timestamp=\d+/, 'timestamp=NOW');

beforeEach(() => {
  exit = vi.spyOn(process, 'exit').mockImplementation(() => undefined as never);
});

afterEach(async () => {
  // the plugin has no way to stop its long poll. faking the timers keeps it from reconnecting.
  vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
  await fhem.close();
  await new Promise((resolve) => setImmediate(resolve));
  vi.useRealTimers();
});

describe('connecting', () => {
  it('opens the long poll for all events as JSON', async () => {
    await connect();

    expect(fhem.streams.map(withoutPort)).toEqual(['/fhem?XHR=1&inform=type=status;addglobal=1;filter=.*;since=null;fmt=JSON&timestamp=NOW']);
    expect(world.longpoll[baseUrl()]).toMatchObject({ connected: true, connects: 1, disconnects: 0 });
  });

  it('remembers the csrf token of FHEMWEB and sends it with every command', async () => {
    await connect({ csrfToken: 'csrf_42' });

    expect(world.csrfToken[baseUrl()]).toBe('csrf_42');
    expect(fhem.requests.slice(1).map((request) => request.url)).toEqual([
      '/fhem?cmd=%7BAttrVal(%22global%22%2C%22userattr%22%2C%22%22)%7D&fwcsrf=csrf_42&XHR=1',
      '/fhem?cmd=jsonlist2%20TYPE%3Dsiri&fwcsrf=csrf_42&XHR=1',
    ]);
  });

  it('keeps the csrf token out of the log', async () => {
    const platform = await connect({ csrfToken: 'csrf_42', answer: (cmd) => (cmd === 'boom' ? { status: 500, body: 'no' } : undefined) });
    const logged = vi.mocked(console.log).mock.calls.length;

    platform.execute('boom');
    await waitFor(() => world.log.lines.includes('log   500: Internal Server Error'), 'the refusal');
    await accessoriesOf(platform);

    expect(fhem.requests.every((request) => request.url.includes('inform=') || request.url.includes('fwcsrf=csrf_42'))).toBe(true);
    expect(world.log.lines.filter((line) => line.includes('fwcsrf=')).length).toBeGreaterThan(4);
    expect(world.log.lines.filter((line) => line.includes('csrf_42'))).toEqual([]);
    expect(logged).toBeGreaterThan(0);
    expect(
      vi
        .mocked(console.log)
        .mock.calls.flat()
        .filter((line) => String(line).includes('csrf_42')),
    ).toEqual([]);
  });

  it('works with a FHEMWEB that has no csrf token', async () => {
    await connect({ csrfToken: undefined });

    expect(world.csrfToken[baseUrl()]).toBe('');
    expect(fhem.requests.slice(1).map((request) => request.url)).toEqual([
      '/fhem?cmd=%7BAttrVal(%22global%22%2C%22userattr%22%2C%22%22)%7D&XHR=1',
      '/fhem?cmd=jsonlist2%20TYPE%3Dsiri&XHR=1',
    ]);
  });

  it('leaves the attributes of fhem alone when they are known', async () => {
    await connect();

    expect(fhem.commands).toEqual(['{AttrVal("global","userattr","")}', 'jsonlist2 TYPE=siri']);
    expect(world.log.lines.map(withoutPort)).toEqual([
      'log Checking devices and attributes...',
      'info   executing: http://127.0.0.1:PORT/fhem?cmd=%7BAttrVal(%22global%22%2C%22userattr%22%2C%22%22)%7D&fwcsrf=***&XHR=1',
      'info   executing: http://127.0.0.1:PORT/fhem?cmd=jsonlist2%20TYPE%3Dsiri&fwcsrf=***&XHR=1',
      'warn no siri device found. please define it.',
    ]);
    expect(exit).not.toHaveBeenCalled();
  });

  it('creates the homebridgeMapping and genericDeviceType attributes when they are missing, and goes on', async () => {
    const platform = await connect({ userattr: 'siriName', devices: [{ Name: 'lamp', ...lamp() }] });
    await waitFor(() => world.log.errors().length > 0, 'the note about the attribute');

    expect(fhem.commands).toEqual(
      expect.arrayContaining([
        '{ addToAttrList( "homebridgeMapping:textField-long" ) }',
        '{addToAttrList( "genericDeviceType:security,ignore,switch,outlet,light,blind,thermometer,thermostat,contact,garage,window,lock" ) }',
      ]),
    );
    expect(world.log.lines).toContain('info homebridgeMapping attribute created.');
    expect(world.log.errors()).toEqual([
      'error genericDeviceType attribute was not known to fhem and was created. restart homebridge after giving it to devices.',
    ]);
    expect(exit).not.toHaveBeenCalled();
    expect(await accessoriesOf(platform)).toHaveLength(1);
  });

  it('notes its version at the siri device', async () => {
    fhem = await startFakeFhem({
      answer: (cmd) => (cmd === 'jsonlist2 TYPE=siri' ? { body: JSON.stringify({ Results: [{ Name: 'siri' }], totalResultsReturned: 1 }) } : undefined),
    });
    world = createWorld();
    const platform = world.platform({ server: '127.0.0.1', port: fhem.port });
    await waitFor(() => fhem.commands.some((cmd) => cmd.startsWith('{$defs{siri}')), 'the version to be noted');

    expect(platform.siri_device).toBe('siri');
    expect(fhem.commands.at(-1)).toMatch(/^\{\$defs\{siri\}->\{"homebridge-fhem version"\} = "\d+\.\d+\.\d+.*"\}$/);
  });

  it('uses the webname, and https when ssl is set', () => {
    fhem = { close: () => Promise.resolve() } as FakeFhem;
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
    world = createWorld();

    expect(world.platform({ server: 'fhem.invalid' }).connection?.base_url).toBe('http://fhem.invalid:8083/fhem');
    expect(world.platform({ server: 'fhem.invalid', port: 8088, webname: 'haus' }).connection?.base_url).toBe('http://fhem.invalid:8088/haus');
    expect(world.platform({ server: 'fhem.invalid', ssl: true }).connection?.base_url).toBe('https://fhem.invalid:8083/fhem');
    expect(exit).not.toHaveBeenCalled();
  });

  it('goes on when ssl is not true or false', () => {
    fhem = { close: () => Promise.resolve() } as FakeFhem;
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
    world = createWorld();

    expect(world.platform({ server: 'fhem.invalid', ssl: 'true' }).connection?.base_url).toBe('https://fhem.invalid:8083/fhem');
    expect(world.platform({ server: 'fhem.invalid', ssl: 'no' }).connection?.base_url).toBe('http://fhem.invalid:8083/fhem');

    expect(world.log.lines).toEqual([
      'warn config: value for ssl has to be boolean. taking "true" as true.',
      'error config: value for ssl has to be boolean. taking "no" as false.',
    ]);
    expect(exit).not.toHaveBeenCalled();
  });

  it('takes from the config whether the certificate of fhem is checked, and leaves it open without a word', () => {
    fhem = { close: () => Promise.resolve() } as FakeFhem;
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
    world = createWorld();
    const auth = { user: 'fhem', pass: 'secret' };

    expect(world.platform({ server: 'fhem.invalid', ssl: true }).connection?.rejectUnauthorized).toBeUndefined();
    expect(world.platform({ server: 'fhem.invalid', ssl: true, auth }).connection?.rejectUnauthorized).toBeUndefined();
    expect(world.platform({ server: 'fhem.invalid', ssl: true, auth, rejectUnauthorized: true }).connection?.rejectUnauthorized).toBe(true);
    expect(world.platform({ server: 'fhem.invalid', ssl: true, auth, rejectUnauthorized: false }).connection?.rejectUnauthorized).toBe(false);
    expect(world.platform({ server: 'fhem.invalid', ssl: true, rejectUnauthorized: 'false' }).connection?.rejectUnauthorized).toBe(false);
  });

  it('does not connect without a server', async () => {
    fhem = { close: () => Promise.resolve() } as FakeFhem;
    world = createWorld();

    const platform = world.platform({});

    expect(world.log.lines).toEqual(['error incomplete configuration ']);
    expect(platform.connection).toBeUndefined();
    expect(await accessoriesOf(platform)).toEqual([]);
  });

  it('saves the history when homebridge shuts down', () => {
    fhem = { close: () => Promise.resolve() } as FakeFhem;
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
    world = createWorld();
    const on = vi.fn();

    world.platform({ server: 'fhem.invalid' }, { on });

    expect(on).toHaveBeenCalledOnce();
    expect(on.mock.calls[0]?.[0]).toBe('shutdown');
  });
});

describe('authentication', () => {
  it('sends user and password with every request', async () => {
    const auth = { user: 'fhem', pass: 'secret' };
    await connect({ auth }, { auth });

    const authorization = `Basic ${Buffer.from('fhem:secret').toString('base64')}`;
    expect(fhem.requests.map((request) => request.authorization)).toEqual([authorization, authorization, authorization]);
    expect(fhem.commands).toEqual(['{AttrVal("global","userattr","")}', 'jsonlist2 TYPE=siri']);
  });

  it('says that the authentication failed when FHEMWEB asks for a password, and tries again with a growing pause', async () => {
    fhem = await startFakeFhem({ auth: { user: 'fhem', pass: 'secret' } });
    world = createWorld();
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
    const platform = world.platform({ server: '127.0.0.1', port: fhem.port });
    const refusal = (pause: number) =>
      `error longpoll refused by fhem with 401 Unauthorized: authentication failed. check user and password (auth) of the platform. retry in: ${pause}msec`;

    await waitFor(() => world.log.errors().length === 1, 'the first refusal');
    expect(world.log.lines).toEqual([refusal(3000)]);

    vi.advanceTimersByTime(2999);
    expect(fhem.requests).toHaveLength(1);
    vi.advanceTimersByTime(1);
    await waitFor(() => world.log.errors().length === 2, 'the second refusal');
    expect(world.log.lines).toEqual([refusal(3000), refusal(6000)]);

    // nothing else is asked of a fhem that lets nobody in, and it is not given up
    for (let attempt = 3; attempt <= 6; attempt++) {
      vi.advanceTimersByTime(30000);
      await waitFor(() => world.log.errors().length === attempt, `refusal ${attempt}`);
    }
    expect(world.log.errors().at(-1)).toBe(refusal(18000));
    expect(fhem.requests.every((request) => request.url.includes('inform='))).toBe(true);
    expect(world.csrfToken[baseUrl()]).toBeUndefined();
    expect(platform.connection?.dead).toBeUndefined();
    expect(world.longpoll[baseUrl()]).toMatchObject({ connected: false, connects: 6, disconnects: 6 });
  });

  it('connects once the password is accepted', async () => {
    fhem = await startFakeFhem({ auth: { user: 'fhem', pass: 'secret' } });
    world = createWorld();
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
    world.platform({ server: '127.0.0.1', port: fhem.port });
    await waitFor(() => world.log.errors().length === 1, 'the refusal');

    fhem.options.auth = undefined;
    vi.advanceTimersByTime(3000);
    await waitFor(() => fhem.commands.includes('jsonlist2 TYPE=siri'), 'the platform to connect');

    expect(world.csrfToken[baseUrl()]).toBe('csrf_fake_token');
    expect(world.longpoll[baseUrl()]).toMatchObject({ connected: true, connects: 2 });
  });

  it('treats 403 like 401', async () => {
    fhem = await startFakeFhem({ forbidden: true });
    world = createWorld();
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });

    world.platform({ server: '127.0.0.1', port: fhem.port });
    await waitFor(() => world.log.errors().length === 1, 'the refusal');

    expect(world.log.errors()[0]).toMatch(/^error longpoll refused by fhem with 403 Forbidden: authentication failed\..* retry in: 3000msec$/);
  });
});

describe('devices', () => {
  it('asks for the devices of the filter and creates an accessory for each, sorted by name', async () => {
    const platform = await connect(
      {
        devices: [
          device({ Internals: { NAME: 'lamp_b' }, Readings: { state: 'on' }, PossibleSets: 'on off' }),
          device({ Internals: { NAME: 'lamp_a' }, Readings: { state: 'off' }, PossibleSets: 'on off' }),
          device({ Internals: { NAME: 'timer', TYPE: 'at' } }),
        ].map((d) => ({ Name: d.Internals.NAME, ...d })),
      },
      { filter: 'room=Wohnzimmer,Küche&x' },
    );
    world.log.clear();

    const accessories = await accessoriesOf(platform);

    expect(accessories.map((accessory) => accessory.name)).toEqual(['lamp-a', 'lamp-b']);
    expect(accessories[0]?.fhem).toBe(platform);
    expect(fhem.commands.at(-1)).toBe('jsonlist2 room=Wohnzimmer,Küche&x');
    expect(fhem.requests.at(-1)?.url).toBe('/fhem?cmd=jsonlist2%20room%3DWohnzimmer%2CK%C3%BCche%26x&fwcsrf=csrf_fake_token&XHR=1');
    expect(world.log.lines.filter((line) => !line.includes('caching')).map(withoutPort)).toEqual([
      'info Fetching FHEM devices...',
      'info fetching: http://127.0.0.1:PORT/fhem?cmd=jsonlist2%20room%3DWohnzimmer%2CK%C3%BCche%26x&fwcsrf=***&XHR=1',
      'info got: 3 results',
      'log lamp_a is switch',
      'log lamp_a has',
      'log   On [state;on,off]',
      'log lamp_b is switch',
      'log lamp_b has',
      'log   On [state;on,off]',
      'error timer: no service type detected',
      'info no accessory created for timer (at)',
    ]);
  });

  it('asks for all devices without a filter', async () => {
    const platform = await connect();

    expect(await accessoriesOf(platform)).toEqual([]);
    expect(fhem.commands.at(-1)).toBe('jsonlist2');
    expect(world.log.lines.at(-1)).toBe('info got: 0 results');
  });

  it.each([
    [undefined, 'function'],
    [true, 'function'],
    [false, 'undefined'],
    ['false', 'undefined'],
  ])('with allowInlineFunctions %j in the config, javascript in a mapping ends up as %s', async (allowInlineFunctions, kind) => {
    const scripted = device({
      Internals: { NAME: 'lamp' },
      Readings: { state: 'on' },
      PossibleSets: 'on off',
      Attributes: { homebridgeMapping: 'On=state,cmdOn=on,cmdOff=off,reading2homekit={return+orig.length<3}' },
    });
    const platform = await connect({ devices: [{ Name: 'lamp', ...scripted }] }, { allowInlineFunctions });

    const accessory = await firstAccessoryOf(platform);

    expect(typeof (accessory.mappings.On as { reading2homekit?: unknown }).reading2homekit).toBe(kind);
  });

  it('leaves out the devices that are not in the scope siri', async () => {
    const platform = await connect({ devices: [{ Name: 'lamp', ...lamp() }] }, { scope: 'alexa' });

    expect(await accessoriesOf(platform)).toEqual([]);
    expect(world.log.lines.at(-1)).toBe('info ignoring lamp for siri');
  });

  it('asks again, with a growing pause, until fhem lists the devices, and hands over no empty list meanwhile', async () => {
    let refuse = true;
    const platform = await connect({
      devices: [{ Name: 'lamp', ...lamp() }],
      answer: (cmd) => (cmd === 'jsonlist2' && refuse ? { status: 500, body: 'no' } : undefined),
    });
    const answered = vi.fn();
    const requests = () => fhem.commands.filter((cmd) => cmd === 'jsonlist2').length;
    world.log.clear();
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });

    platform.accessories(answered);
    await waitFor(() => world.log.errors().length === 3, 'the first failure');
    vi.advanceTimersByTime(2999);
    expect(requests()).toBe(1);
    vi.advanceTimersByTime(1);
    await waitFor(() => world.log.errors().length === 6, 'the second failure');
    vi.advanceTimersByTime(5999);
    expect(requests()).toBe(2);
    expect(answered).not.toHaveBeenCalled();

    refuse = false;
    vi.advanceTimersByTime(1);
    await waitFor(() => answered.mock.calls.length > 0, 'the accessories');

    expect(world.log.errors()).toEqual([
      'error There was a problem connecting to FHEM',
      'error   500: Internal Server Error',
      'error fetching the devices failed for the 1. time, trying again in: 3000msec',
      'error There was a problem connecting to FHEM',
      'error   500: Internal Server Error',
      'error fetching the devices failed for the 2. time, trying again in: 6000msec',
    ]);
    expect(requests()).toBe(3);
    expect(answered).toHaveBeenCalledOnce();
    expect(answered.mock.calls[0]?.[0]).toMatchObject([{ name: 'lamp' }]);
  });

  it('asks again when the answer of fhem is no list of devices', async () => {
    let broken = true;
    const platform = await connect({
      devices: [{ Name: 'lamp', ...lamp() }],
      answer: (cmd) => (cmd === 'jsonlist2' && broken ? { body: '<html>Unknown command</html>' } : undefined),
    });
    const answered = vi.fn();
    world.log.clear();
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });

    platform.accessories(answered);
    await waitFor(() => world.log.errors().length === 3, 'the failure');

    expect(world.log.errors()).toEqual([
      'error There was a problem connecting to FHEM',
      'error   the answer is no list of devices',
      'error fetching the devices failed for the 1. time, trying again in: 3000msec',
    ]);
    expect(answered).not.toHaveBeenCalled();

    broken = false;
    vi.advanceTimersByTime(3000);
    await waitFor(() => answered.mock.calls.length > 0, 'the accessories');
    expect(answered.mock.calls[0]?.[0]).toHaveLength(1);
  });

  it('waits for the csrf token before it asks', async () => {
    fhem = await startFakeFhem({ devices: [{ Name: 'lamp', ...lamp() }] });
    world = createWorld();
    const platform = world.platform({ server: '127.0.0.1', port: fhem.port });

    const accessories = await accessoriesOf(platform);

    expect(accessories).toHaveLength(1);
    expect(fhem.requests.at(-1)?.url).toContain('fwcsrf=csrf_fake_token');
  });
});

describe('events', () => {
  async function published(options: FakeFhemOptions = {}): Promise<{ platform: Platform; accessory: Accessory }> {
    const platform = await connect({ devices: [{ Name: 'lamp', ...lamp() }], ...options });
    const accessory = await firstAccessoryOf(platform);
    return { platform, accessory };
  }

  it('updates the characteristic when a reading changes', async () => {
    const { accessory } = await published();
    const on = characteristicOf(serviceOf(accessory.getServices(), 'Switch'), hap.Characteristic.On);

    fhem.event('lamp-state', 'off');
    await waitFor(() => on.value === false, 'the characteristic to change');

    expect(world.cached['lamp-state']).toBe('off');
    expect(world.longpoll[baseUrl()]?.last_event_time).toBeTypeOf('number');
  });

  it('puts lines together that arrive in pieces, and takes several lines at once', async () => {
    const { accessory } = await published();
    accessory.getServices();
    accessory.subscribe('lamp-a');
    accessory.subscribe('lamp-b');

    fhem.send('["lamp-st');
    await waitFor(() => (world.longpoll[baseUrl()]?.received_total as number) > 0, 'the first piece');
    expect(world.cached['lamp-state']).toBe('on');

    fhem.send('ate","off","x"]\n["lamp-a","1","x"]\n\n["lamp-b","2","x"]\n["lamp-a","3"');
    await waitFor(() => world.cached['lamp-b'] === '2', 'the events');

    expect(world.cached).toMatchObject({ 'lamp-state': 'off', 'lamp-a': '1', 'lamp-b': '2' });

    fhem.send(',"x"]\n');
    await waitFor(() => world.cached['lamp-a'] === '3', 'the last event');
  });

  it('understands the older format with << between the parts', async () => {
    const { accessory } = await published();
    accessory.getServices();

    fhem.send('lamp-state<<off<<<div>off</div>\n');
    await waitFor(() => world.cached['lamp-state'] === 'off', 'the event');
  });

  it('ignores what it has no use for', async () => {
    const { accessory } = await published();
    accessory.getServices();
    accessory.subscribe('lamp-state-ts');
    accessory.subscribe('#FHEMWEB:WEB');
    accessory.subscribe('nodash');
    const before = { ...world.cached };

    fhem.send(
      [
        '["lamp-state-ts","2026-08-16 12:00:00","x"]',
        '["#FHEMWEB:WEB","x","x"]',
        '["nodash","x","x"]',
        '["lamp-state","set-off","x"]',
        '["other-state","off","x"]',
        '["lamp-state","off"]',
        '[broken',
        'lamp-state<<off',
        '["lamp-other","done","x"]',
        '',
      ].join('\n'),
    );
    accessory.subscribe('lamp-other');
    fhem.event('lamp-other', 'done');
    await waitFor(() => world.cached['lamp-other'] === 'done', 'the last event');

    expect(world.cached).toEqual({ ...before, 'lamp-other': 'done' });
  });

  it('finds a device with a dash in its name by the whole id', async () => {
    const { accessory } = await published({
      devices: [{ Name: 'eg-lamp', ...device({ Internals: { NAME: 'eg-lamp' }, Readings: { state: 'on' }, PossibleSets: 'on off' }) }],
    });
    const on = characteristicOf(serviceOf(accessory.getServices(), 'Switch'), hap.Characteristic.On);

    fhem.event('eg-lamp-state', 'off');
    await waitFor(() => on.value === false, 'the characteristic to change');
  });

  it('derives hue, saturation and brightness from the xy colour of a light', async () => {
    const bulb = device({
      Internals: { NAME: 'bulb', TYPE: 'HUEDevice' },
      Readings: { state: 'on', onoff: '1', bri: '254', hue: '8418', sat: '140', xy: '0.4573,0.41', colormode: 'xy' },
      PossibleSets: 'on off bri hue sat xy',
    });
    const { accessory } = await published({ devices: [{ Name: 'bulb', ...bulb }] });
    accessory.getServices();

    fhem.event('bulb-xy', '0.7,0.3');
    await waitFor(() => world.cached['bulb-xy'] === '0.7,0.3', 'the event');

    expect(world.cached['bulb-h']).toBeCloseTo(0.0112, 4);
    expect(world.cached['bulb-s']).toBeCloseTo(0.9876, 4);
    expect(world.cached['bulb-v']).toBeCloseTo(0.9451, 4);
  });

  it('derives hue, saturation and brightness from the colour temperature of a light', async () => {
    const bulb = device({
      Internals: { NAME: 'bulb', TYPE: 'HUEDevice' },
      Readings: { state: 'on', onoff: '1', bri: '254', xy: '0.4573,0.41', colormode: 'ct' },
      PossibleSets: 'on off bri xy ct',
    });
    const { accessory } = await published({ devices: [{ Name: 'bulb', ...bulb }] });
    accessory.getServices();
    accessory.subscribe('bulb-ct');
    world.log.clear();

    fhem.event('bulb-ct', '366');
    await waitFor(() => world.cached['bulb-ct'] === '366', 'the event');

    // 366 mired is the warm white ffc799
    expect(world.cached['bulb-h']).toBeCloseTo(0.0752, 4);
    expect(world.cached['bulb-s']).toBeCloseTo(0.4, 4);
    expect(world.cached['bulb-v']).toBe(1);
    expect(world.log.errors()).toEqual([]);
  });

  it('reports an event it can not read and goes on with what arrived with it', async () => {
    const { accessory } = await published({ devices: [{ Name: 'lamp', ...lamp() }] });
    accessory.getServices();
    world.log.clear();

    // a value that is no text
    fhem.send('["lamp-state",1,"x"]\n["lamp-state","off","x"]\n["lamp-state",2,"x"]\n["lamp-state","on","x"]\n');
    await waitFor(() => world.log.errors().length > 1, 'the errors');

    expect(world.log.errors()).toEqual([
      'error   error in longpoll connection: TypeError: value.match is not a function',
      'error   error in longpoll connection: TypeError: value.match is not a function',
    ]);
    expect(world.log.lines.filter((line) => line.includes('caching: On'))).toEqual([
      "info     caching: On: false (as boolean; from 'off')",
      "info     caching: On: true (as boolean; from 'on')",
    ]);
    expect(world.cached['lamp-state']).toBe('on');
  });
});

describe('reconnecting', () => {
  it('reconnects 200 milliseconds after the stream ended and asks for the events since the last one', async () => {
    const platform = await connect({ devices: [{ Name: 'lamp', ...lamp() }] });
    (await firstAccessoryOf(platform)).getServices();
    fhem.event('lamp-state', 'off');
    await waitFor(() => world.cached['lamp-state'] === 'off', 'the event');
    const lastEvent = world.longpoll[baseUrl()]?.last_event_time as number;
    world.log.clear();

    fhem.endStreams();
    await waitFor(() => fhem.streams.length === 2, 'the second long poll');

    expect(world.log.lines[0]).toBe('error longpoll ended, reconnect in: 200msec');
    expect(fhem.streams[1]).toContain(`;since=${lastEvent / 1000};fmt=JSON`);
    expect(world.longpoll[baseUrl()]).toMatchObject({ connected: true, connects: 2 });
  });

  it('looks at the attributes again after every reconnect, and for the siri device as long as there is none', async () => {
    await connect();
    fhem.endStreams();
    await waitFor(() => fhem.commands.filter((cmd) => cmd === 'jsonlist2 TYPE=siri').length === 2, 'the second check');

    expect(fhem.commands.filter((cmd) => cmd.startsWith('{AttrVal'))).toHaveLength(2);
  });

  it('does not look for the siri device again once it is known', async () => {
    const platform = await connect({
      answer: (cmd) => (cmd === 'jsonlist2 TYPE=siri' ? { body: JSON.stringify({ Results: [{ Name: 'siri' }], totalResultsReturned: 1 }) } : undefined),
    });
    expect(platform.siri_device).toBe('siri');
    await waitFor(() => fhem.commands.some((cmd) => cmd.startsWith('{$defs{siri}')), 'the version to be noted');

    fhem.endStreams();
    await waitFor(() => fhem.commands.filter((cmd) => cmd.startsWith('{AttrVal')).length === 2, 'the second check');
    // long enough for a second lookup to arrive, which is sent right after the check
    await new Promise((resolve) => setTimeout(resolve, 50));

    expect(fhem.commands.filter((cmd) => cmd === 'jsonlist2 TYPE=siri')).toHaveLength(1);
    expect(fhem.commands.filter((cmd) => cmd.startsWith('{$defs{siri}'))).toHaveLength(1);
  });

  it('gives up after four failed attempts when it never reached fhem', async () => {
    fhem = await startFakeFhem();
    const port = fhem.port;
    await fhem.close();
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
    world = createWorld();

    const platform = world.platform({ server: '127.0.0.1', port });
    for (const attempt of [1, 2, 3]) {
      await waitFor(() => world.log.errors().length === attempt, `attempt ${attempt}`);
      vi.runOnlyPendingTimers();
    }
    await waitFor(() => world.log.errors().length === 4, 'the last attempt');

    expect(world.log.errors().map((line) => line.replace(/longpoll error: .*?, /, 'longpoll error: (error), '))).toEqual([
      'error longpoll error: (error), retry in: 3000msec',
      'error longpoll error: (error), retry in: 6000msec',
      'error longpoll error: (error), retry in: 9000msec',
      'error longpoll error: (error), retrys exhausted',
    ]);
    expect(platform.connection?.dead).toBe(true);
    expect(await accessoriesOf(platform)).toEqual([]);
  });

  it('does not give up on a fhem whose certificate it does not trust, and says what to do', async () => {
    const server = https.createServer(selfSignedCertificate(), (_request, response) => response.end());
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
    fhem = {
      close: () => {
        server.closeAllConnections();
        return new Promise<void>((resolve) => server.close(() => resolve()));
      },
    } as FakeFhem;
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
    world = createWorld();

    const platform = world.platform({ server: '127.0.0.1', port: (server.address() as AddressInfo).port, ssl: true, rejectUnauthorized: true });
    for (const attempt of [1, 2, 3, 4, 5]) {
      await waitFor(() => world.log.errors().length === attempt, `attempt ${attempt}`);
      vi.runOnlyPendingTimers();
    }

    expect(world.log.errors().map((line) => line.replace(/self-signed certificate.*? \(/, 'self-signed certificate ('))).toEqual(
      [3000, 6000, 9000, 12000, 15000].map(
        (pause) =>
          'error longpoll error: Error: self-signed certificate (the certificate of fhem is not trusted. make node trust it, ' +
          `or set rejectUnauthorized to false for the platform), retry in: ${pause}msec`,
      ),
    );
    expect(platform.connection?.dead).toBeUndefined();
  });

  it('keeps trying with neverTimeout', async () => {
    fhem = await startFakeFhem();
    const port = fhem.port;
    await fhem.close();
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
    world = createWorld();

    const platform = world.platform({ server: '127.0.0.1', port, neverTimeout: true });
    for (const attempt of [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11]) {
      await waitFor(() => world.log.errors().length === attempt, `attempt ${attempt}`);
      vi.runOnlyPendingTimers();
    }

    expect(world.log.errors().at(-1)).toMatch(/retry in: 30000msec$/);
    expect(platform.connection?.dead).toBeUndefined();
  });
});

describe('commands', () => {
  it('sends the command of a characteristic to fhem', async () => {
    const platform = await connect({ devices: [{ Name: 'lamp', ...lamp() }] });
    const accessory = await firstAccessoryOf(platform);
    accessory.getServices();
    world.log.clear();

    accessory.command(accessory.mappings.On as never, 0);
    await waitFor(() => fhem.commands.at(-1) === 'set lamp off', 'the command');

    expect(fhem.requests.at(-1)?.url).toBe('/fhem?cmd=set%20lamp%20off&fwcsrf=csrf_fake_token&XHR=1');
    expect(world.log.lines.map(withoutPort)).toEqual([
      'info lamp: executing set cmd for On with value 0',
      'info   executing: http://127.0.0.1:PORT/fhem?cmd=set%20lamp%20off&fwcsrf=***&XHR=1',
    ]);
  });

  it('hands the answer to the caller without line breaks', async () => {
    const platform = await connect({ answer: (cmd) => (cmd === 'list' ? { body: 'a\r\nb\nc\n' } : undefined) });

    const result = await new Promise((resolve) => {
      platform.execute('list', resolve);
    });

    expect(result).toBe('abc');
  });

  it('sends a command whole, also with characters that separate commands and parameters in a url', async () => {
    const platform = await connect();

    platform.execute('set lamp on;set other off&x=1#y %?');
    await waitFor(() => fhem.requests.some((request) => request.url.includes('set%20lamp')), 'the command');

    expect(fhem.requests.at(-1)?.url).toBe('/fhem?cmd=set%20lamp%20on%3Bset%20other%20off%26x%3D1%23y%20%25%3F&fwcsrf=csrf_fake_token&XHR=1');
    expect(fhem.commands.at(-1)).toBe('set lamp on;set other off&x=1#y %?');
  });

  it('reports a command fhem refuses and does not answer the caller', async () => {
    const platform = await connect({ answer: (cmd) => (cmd === 'boom' ? { status: 500, body: 'no' } : undefined) });
    const answered = vi.fn();
    world.log.clear();

    platform.execute('boom', answered);
    await waitFor(() => world.log.lines.length === 3, 'the report');

    expect(world.log.lines.map(withoutPort)).toEqual([
      'info   executing: http://127.0.0.1:PORT/fhem?cmd=boom&fwcsrf=***&XHR=1',
      'log There was a problem connecting to FHEM (http://127.0.0.1:PORT/fhem?cmd=boom&fwcsrf=***&XHR=1).',
      'log   500: Internal Server Error',
    ]);
    expect(answered).not.toHaveBeenCalled();
  });

  it('asks fhem for a reading of another device when the accessory is created', async () => {
    const platform = await connect({
      readings: { 'aussen temperature': '7.5' },
      devices: [
        {
          Name: 'lamp',
          ...device({
            Internals: { NAME: 'lamp' },
            Readings: { state: 'on' },
            PossibleSets: 'on off',
            Attributes: { homebridgeMapping: 'CurrentTemperature=aussen:temperature' },
          }),
        },
      ],
    });

    const accessory = await firstAccessoryOf(platform);
    await waitFor(() => world.cached['aussen-temperature'] === '7.5', 'the reading');

    expect(fhem.commands.at(-1)).toBe('{ReadingsVal("aussen","temperature","")}');
    expect((accessory.mappings.CurrentTemperature as { cached?: unknown }).cached).toBeUndefined();
  });
});

describe('jsFunctions', () => {
  let storage: string;

  beforeEach(() => {
    storage = mkdtempSync(join(tmpdir(), 'fhem2hb-'));
  });

  afterEach(() => {
    rmSync(storage, { recursive: true, force: true });
  });

  it('loads the file from the homebridge storage directory', async () => {
    writeFileSync(join(storage, 'functions.cjs'), 'module.exports = { half: function(mapping, orig) { return orig / 2 } };');

    const platform = await connect(
      {
        devices: [
          {
            Name: 'lamp',
            ...device({
              Internals: { NAME: 'lamp' },
              Readings: { state: 'on', level: '80' },
              PossibleSets: 'on off',
              Attributes: { genericDeviceType: 'light', homebridgeMapping: 'Brightness=level,reading2homekit=half' },
            }),
          },
        ],
      },
      { jsFunctions: 'functions.cjs' },
      { storagePath: storage },
    );
    const accessory = await firstAccessoryOf(platform);

    expect((accessory.mappings.Brightness as { cached?: unknown }).cached).toBe(40);
  });

  it('loads a file given with its full path', async () => {
    writeFileSync(join(storage, 'absolute.cjs'), 'module.exports = { one: function() { return 1 } };');

    const platform = await connect({}, { jsFunctions: join(storage, 'absolute.cjs') });

    expect(Object.keys(platform.jsFunctions as object)).toEqual(['one']);
  });

  it('goes on without the functions when the file can not be loaded', async () => {
    const platform = await connect({}, { jsFunctions: 'missing.cjs' }, { storagePath: storage });

    expect(platform.jsFunctions).toBeUndefined();
    expect(world.log.lines[0]).toMatch(/^error {3}jsFunctions: Error: Cannot find module/);
  });
});
