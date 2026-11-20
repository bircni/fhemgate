// smaller parts: the HMCCU reading lookup, the custom characteristics, the debug page, and loading the plugin
import { describe, expect, it, vi } from 'vitest';
import { device, hmccuDevice } from './support/devices.ts';
import { createWorld, customUUIDs, hap, hmccu, initializer } from './support/subject.ts';

describe('HMCCU datapoints', () => {
  const d = hmccuDevice({
    Readings: { '1.STATE': '0', '4.STATE': '1', 'ABC:4.LEVEL': '0.5', level: '1', '4.LEVEL_2': '0', WINDOW_STATE: '0' },
    Attributes: { controldatapoint: '4.STATE', statedatapoint: 'ABC:1.LEVEL' },
  });

  it('finds the readings of a datapoint in every reading format, the least qualified first', () => {
    expect(hmccu.readings(d, 'STATE')).toEqual(['1.STATE', '4.STATE']);
    expect(hmccu.readings(d, 'LEVEL')).toEqual(['level', 'ABC:4.LEVEL']);
    expect(hmccu.readings(d, 'MISSING')).toEqual([]);
  });

  it('knows the channel the control or state datapoint is pinned to', () => {
    expect(hmccu.channel(d, 'STATE')).toBe('4');
    expect(hmccu.channel(d, 'state')).toBe('4');
    expect(hmccu.channel(d, 'LEVEL')).toBe('1');
    expect(hmccu.channel(d, 'OTHER')).toBeUndefined();
    expect(hmccu.channel(hmccuDevice({}), 'STATE')).toBeUndefined();
  });

  it('prefers the reading of the pinned channel', () => {
    expect(hmccu.reading(d, 'STATE')).toBe('4.STATE');
    expect(hmccu.reading(d, 'LEVEL')).toBe('level');
    expect(hmccu.reading(d, 'LEVEL_2')).toBe('4.LEVEL_2');
    expect(hmccu.reading(d, 'MISSING')).toBeUndefined();
  });

  it('builds the datapoint to set from the channel of the reading, or the pinned channel', () => {
    expect(hmccu.datapoint(d, '4.STATE', 'STATE')).toBe('4.STATE');
    expect(hmccu.datapoint(d, 'ABC:4.LEVEL', 'LEVEL')).toBe('4.LEVEL');
    expect(hmccu.datapoint(d, 'level', 'LEVEL')).toBe('1.LEVEL');
    expect(hmccu.datapoint(d, undefined, 'STATE')).toBe('4.STATE');
    expect(hmccu.datapoint(d, 'WINDOW_STATE', 'WINDOW_STATE')).toBe('WINDOW_STATE');
  });

  it.each([
    [undefined, false],
    ['LEVEL:0:1:0:100', true],
    ['4.LEVEL:0:1:0:100', true],
    ['!LEVEL:0:1:0:100', true],
    [':0:1:0:100', true],
    ['TEMPERATURE:0:1:0:100', false],
    ['TEMPERATURE:0:1:0:100,LEVEL:0:1:0:100', true],
    ['LEVEL', false],
  ])('ccuscaleval %s scales the level: %s', (ccuscaleval, scales) => {
    expect(hmccu.scalesLevel(hmccuDevice({ Attributes: ccuscaleval === undefined ? {} : { ccuscaleval } }))).toBe(scales);
  });
});

describe('custom characteristics', () => {
  it('have the ids eve and other apps know them by', () => {
    expect(customUUIDs).toEqual({
      xVolume: '4648454d-0101-686F-6D65-627269646765',
      CT: 'E887EF67-509A-552D-A138-3DA215050F46',
      Volume: '00001001-0000-1000-8000-135D67EC4377',
      Voltage: 'E863F10A-079E-48FF-8F27-9C2605A29F52',
      Current: 'E863F126-079E-48FF-8F27-9C2605A29F52',
      Power: 'E863F10D-079E-48FF-8F27-9C2605A29F52',
      Energy: 'E863F10C-079E-48FF-8F27-9C2605A29F52',
      AirPressure: 'E863F10F-079E-48FF-8F27-9C2605A29F52',
      Actuation: 'E863F12E-079E-48FF-8F27-9C2605A29F52',
    });
  });
});

describe('debug page', () => {
  it('links to its two pages', () => {
    expect(createWorld().debugPage('/')).toBe('<a href="/cached">cached</a><br><a href="/subscriptions">subscriptions</a>');
  });

  it('lists the connections and what is cached for every subscribed reading', () => {
    const world = createWorld();
    world
      .accessory(
        device({
          Internals: { NAME: 'valve', TYPE: 'CUL_HM', DEF: '123456' },
          Readings: { 'desired-temp': '20.0', 'measured-temp': '19.0', mode: 'auto' },
          Attributes: { subType: 'thermostat' },
          PossibleSets: 'desired-temp:slider,4.5,0.5,30.5 mode',
        }),
      )
      .getServices();
    world.longpoll['http://fhem:8083/fhem'] = { connected: true, connects: 2, received: 10, received_total: 30, last_event_time: Date.UTC(2026, 7, 16, 12) };
    world.longpoll['http://other:8083/fhem'] = { connected: false, connects: 1, received: 0, received_total: 0 };

    // the name of the time zone in the date depends on the language of the machine
    expect(
      world
        .debugPage('/cached')
        .replace(/ \([^)]*\)<br>/, ' (UTC)<br>')
        .split('<br>'),
    ).toMatchSnapshot();
  });

  it('dumps the subscriptions', () => {
    const world = createWorld();
    world.accessory(device({ Internals: { NAME: 'lamp' }, Readings: { state: 'on' }, PossibleSets: 'on off' })).getServices();

    const page = world.debugPage('/subscriptions');

    expect(page).toMatch(/^<a href="\/">home<\/a><br><br><pre>subscriptions: \{/);
    expect(page).toContain('&#39;lamp-state&#39;: [');
    expect(page).toMatch(/<\/pre>$/);
  });

  it('shows what comes from fhem as text, whatever it looks like', () => {
    const world = createWorld();
    const lamp = device({ Internals: { NAME: 'lamp' }, Readings: { state: '<script>alert("x")</script>' }, PossibleSets: 'on off' });
    lamp.Attributes.homebridgeMapping = 'On=state,values=/script/:1 <b>Hue</b>=state';
    world.accessory(lamp).getServices();
    world.subscriptions['<img src=x>'] = world.subscriptions['lamp-state'];
    world.longpoll['http://<i>fhem</i>:8083/fhem'] = { connected: true, connects: 1, received: 0, received_total: 0 };

    const cached = world.debugPage('/cached');
    const subscriptions = world.debugPage('/subscriptions');

    expect(cached).toContain('lamp-state: &#60;script&#62;alert(&#34;x&#34;)&#60;/script&#62;<br>');
    expect(cached).toContain('&#60;img src=x&#62;: undefined<br>');
    expect(cached).toContain('http://&#60;i&#62;fhem&#60;/i&#62;:8083/fhem<br>');
    expect(cached.replaceAll(/<\/?a[^>]*>|<br>/g, '')).not.toMatch(/[<>]/);
    expect(subscriptions.replaceAll(/<\/?a[^>]*>|<br>|<\/?pre>/g, '')).not.toMatch(/[<>]/);
  });
});

describe('loading the plugin', () => {
  it('registers the fhemgate platform', () => {
    const registerPlatform = vi.fn();

    initializer({ version: 2.7, user: { storagePath: () => '/nonexistent' }, hap, registerPlatform });

    expect(registerPlatform).toHaveBeenCalledOnce();
    expect(registerPlatform.mock.calls[0]?.[0]).toBe('fhemgate');
    expect(registerPlatform.mock.calls[0]?.[1]).toBeTypeOf('function');
  });
});
