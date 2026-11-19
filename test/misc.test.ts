// smaller parts: the custom characteristics, the debug page, and loading the plugin
import { describe, expect, it, vi } from 'vitest';
import { device } from './support/devices.ts';
import { createWorld, customUUIDs, hap, initializer } from './support/subject.ts';

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
    expect(page).toContain("'lamp-state': [");
    expect(page).toMatch(/<\/pre>$/);
  });
});

describe('loading the plugin', () => {
  it('registers the FHEM platform', () => {
    const registerPlatform = vi.fn();

    initializer({ version: 2.7, user: { storagePath: () => '/nonexistent' }, hap, registerPlatform });

    expect(registerPlatform).toHaveBeenCalledOnce();
    expect(registerPlatform.mock.calls[0]?.[0]).toBe('FHEM');
    expect(registerPlatform.mock.calls[0]?.[1]).toBeTypeOf('function');
  });
});
