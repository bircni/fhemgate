// what an accessory does once homekit talks to it
import { afterEach, describe, expect, it, vi } from 'vitest';
import { device } from './support/devices.ts';
import { characteristicOf, read, serviceOf, settle, write } from './support/homekit.ts';
import { createWorld, hap } from './support/subject.ts';
import type { Mapping } from './support/types.ts';

const { Characteristic } = hap;

const lamp = () => device({ Internals: { NAME: 'lamp' }, Readings: { state: 'on' }, PossibleSets: 'on off toggle' });

afterEach(() => {
  vi.useRealTimers();
});

describe('reading a characteristic', () => {
  it('answers with the value cached from the reading', () => {
    const world = createWorld();
    const services = world.accessory(lamp()).getServices();

    const result = read(characteristicOf(serviceOf(services, 'Switch'), Characteristic.On));

    expect(result).toEqual({ error: undefined, value: true, answered: true });
    expect(world.sent).toEqual([]);
  });

  it('asks fhem when the mapping is not cached', () => {
    const world = createWorld({ respond: () => 'off' });
    const accessory = world.accessory(device({
      Internals: { NAME: 'lamp' }, Readings: { state: 'on' }, PossibleSets: 'on off',
      Attributes: { homebridgeMapping: 'On=state,nocache=1,cmdOn=on,cmdOff=off' },
    }));
    const services = accessory.getServices();

    const result = read(characteristicOf(serviceOf(services, 'Switch'), Characteristic.On));

    expect(world.sent).toEqual(['{ReadingsVal("lamp","state","")}']);
    expect(result).toEqual({ error: undefined, value: false, answered: true });
    expect(world.cached['lamp-state']).toBe('off');
  });

  it('answers with an error when fhem returns something the mapping can not convert', () => {
    const world = createWorld({ respond: () => 'set-on' });
    const accessory = world.accessory(device({
      Internals: { NAME: 'lamp' }, Readings: { state: 'on' }, PossibleSets: 'on off',
      Attributes: { homebridgeMapping: 'On=state,nocache=1' },
    }));
    const services = accessory.getServices();

    expect(read(characteristicOf(serviceOf(services, 'Switch'), Characteristic.On))).toEqual({ error: 1, value: undefined, answered: true });
  });

  it('never answers when fhem does not', () => {
    const world = createWorld();
    const accessory = world.accessory(device({
      Internals: { NAME: 'lamp' }, Readings: { state: 'on' }, PossibleSets: 'on off',
      Attributes: { homebridgeMapping: 'On=state,nocache=1' },
    }));

    expect(read(characteristicOf(serviceOf(accessory.getServices(), 'Switch'), Characteristic.On)).answered).toBe(false);
  });

  it('asks fhem for a reading named undefined when a mapping has only a default', () => {
    const world = createWorld();
    const accessory = world.accessory(device({
      Internals: { NAME: 'lamp' }, Readings: { state: 'on' }, PossibleSets: 'on off',
      Attributes: { homebridgeMapping: 'StatusActive=default=1' },
    }));
    const services = accessory.getServices();
    world.sent.length = 0;

    read(characteristicOf(serviceOf(services, 'Switch'), Characteristic.StatusActive));

    expect(world.sent).toEqual(['{ReadingsVal("lamp","undefined","")}']);
  });

  it('answers normally for a device that is not reachable, as homekit has no Reachable characteristic any more', () => {
    const world = createWorld();
    const accessory = world.accessory(device({
      Internals: { NAME: 'bulb', TYPE: 'HUEDevice' }, Readings: { state: 'on', reachable: '0' }, PossibleSets: 'on off',
    }));

    const result = read(characteristicOf(serviceOf(accessory.getServices(), 'Switch'), Characteristic.On));

    expect(result).toEqual({ error: undefined, value: true, answered: true });
    expect((accessory.mappings.Reachable as Mapping).cached).toBeUndefined();
    expect(world.subscriptions['bulb-reachable']).toBeUndefined();
  });

  it('answers unreachable for every characteristic once the reachable mapping is cached as false', () => {
    const world = createWorld();
    const accessory = world.accessory(device({
      Internals: { NAME: 'bulb', TYPE: 'HUEDevice' }, Readings: { state: 'on', reachable: '0' }, PossibleSets: 'on off',
    }));
    const services = accessory.getServices();
    (accessory.mappings.Reachable as Mapping).cached = false;

    expect(read(characteristicOf(serviceOf(services, 'Switch'), Characteristic.On))).toEqual({ error: 'unreachable', value: undefined, answered: true });
  });

  it('answers the name with the siriName', () => {
    const world = createWorld();
    const accessory = world.accessory(device({
      Internals: { NAME: 'lamp' }, Readings: { state: 'on' }, PossibleSets: 'on off', Attributes: { alias: 'Lampe', siriName: 'Stehlampe' },
    }));
    const name = characteristicOf(serviceOf(accessory.getServices(), 'AccessoryInformation'), Characteristic.Name);

    expect(read(name)).toEqual({ error: null, value: 'Stehlampe', answered: true });
    expect(write(name, 'Anders').answered).toBe(true);
    expect(accessory.siriName).toBe('Stehlampe');
    expect(world.sent).toEqual([]);
  });

  it('answers the firmware revision from its reading', () => {
    const world = createWorld();
    const accessory = world.accessory(device({
      Internals: { NAME: 'plug', TYPE: 'ZWave', DEF: 'c1 2' }, Readings: { state: 'on', firmware: '3.2' }, PossibleSets: 'on off',
    }));
    const firmware = characteristicOf(serviceOf(accessory.getServices(), 'AccessoryInformation'), Characteristic.FirmwareRevision);

    expect(firmware.value).toBe('3.2');
    expect(read(firmware)).toEqual({ error: undefined, value: '3.2', answered: true });
  });
});

describe('writing a characteristic', () => {
  it('sends the command to fhem', () => {
    const world = createWorld();
    const on = characteristicOf(serviceOf(world.accessory(lamp()).getServices(), 'Switch'), Characteristic.On);

    expect(write(on, false).answered).toBe(true);
    write(on, true);

    expect(world.sent).toEqual(['set lamp off', 'set lamp on']);
  });

  it('sends nothing when the value comes from fhem', () => {
    const world = createWorld();
    const on = characteristicOf(serviceOf(world.accessory(lamp()).getServices(), 'Switch'), Characteristic.On);

    expect(write(on, false, 'fromFHEM').answered).toBe(true);

    expect(world.sent).toEqual([]);
  });

  it('takes a reading that changed in fhem without sending it back', async () => {
    const world = createWorld();
    const on = characteristicOf(serviceOf(world.accessory(lamp()).getServices(), 'Switch'), Characteristic.On);

    world.update('lamp-state', 'off');
    await settle();

    expect(on.value).toBe(false);
    expect(world.sent).toEqual([]);
  });

  it('waits a second with a delayed command and only sends the last value', () => {
    vi.useFakeTimers();
    const world = createWorld();
    const accessory = world.accessory(device({
      Internals: { NAME: 'dimmer', TYPE: 'CUL_HM', DEF: '123456' }, Readings: { pct: '10', state: '10' }, PossibleSets: 'on off pct',
    }));
    const brightness = characteristicOf(serviceOf(accessory.getServices(), 'Lightbulb'), Characteristic.Brightness);

    write(brightness, 20);
    vi.advanceTimersByTime(900);
    write(brightness, 30);
    vi.advanceTimersByTime(999);
    expect(world.sent).toEqual([]);

    vi.advanceTimersByTime(1);
    expect(world.sent).toEqual(['set dimmer pct 30']);
    expect(accessory.delayed_timers).toEqual({});
  });

  it('uses the given delay, but at least half a second', () => {
    vi.useFakeTimers();
    const world = createWorld();
    const accessory = world.accessory(device({
      Internals: { NAME: 'd' }, Readings: { a: '1', b: '1' }, PossibleSets: 'a b',
      Attributes: { genericDeviceType: 'light', homebridgeMapping: 'Brightness=a,cmd=a,delay=100\nSaturation=b,cmd=b,delay=2000' },
    }));
    const service = serviceOf(accessory.getServices(), 'Lightbulb');

    write(characteristicOf(service, Characteristic.Brightness), 5);
    write(characteristicOf(service, Characteristic.Saturation), 6);
    vi.advanceTimersByTime(499);
    expect(world.sent).toEqual([]);
    vi.advanceTimersByTime(1);
    expect(world.sent).toEqual(['set d a 5']);
    vi.advanceTimersByTime(1500);
    expect(world.sent).toEqual(['set d a 5', 'set d b 6']);
  });

  it('still sends On while a delayed command is waiting', () => {
    vi.useFakeTimers();
    const world = createWorld();
    const accessory = world.accessory(device({
      Internals: { NAME: 'dimmer', TYPE: 'CUL_HM', DEF: '123456' }, Readings: { pct: '10', state: '10' }, PossibleSets: 'on off pct',
    }));
    const service = serviceOf(accessory.getServices(), 'Lightbulb');

    write(characteristicOf(service, Characteristic.Brightness), 20);
    write(characteristicOf(service, Characteristic.On), true);

    expect(world.sent).toEqual(['set dimmer on']);
  });

  it('falls back to the default after the timeout of a push button', async () => {
    vi.useFakeTimers();
    const world = createWorld();
    const accessory = world.accessory(device({
      Internals: { NAME: 'door', TYPE: 'CUL_HM', DEF: '123456' }, Readings: { lock: 'locked', state: 'locked' },
      Attributes: { model: 'HM-SEC-KEY' }, PossibleSets: 'lock unlock open',
    }));
    const target = characteristicOf(serviceOf(accessory.getServices(), 'LockMechanism'), Characteristic.TargetDoorState);
    expect(target.value).toBe(Characteristic.TargetDoorState.CLOSED);

    target.updateValue(Characteristic.TargetDoorState.OPEN);
    write(target, Characteristic.TargetDoorState.OPEN);
    expect(world.sent).toEqual(['set door open']);

    await vi.advanceTimersByTimeAsync(500);
    expect(target.value).toBe(Characteristic.TargetDoorState.CLOSED);
  });
});

describe('commands', () => {
  it('identifies a device that can toggle by toggling it twice', () => {
    const world = createWorld();
    const accessory = world.accessory(lamp());
    const identified = vi.fn();

    accessory.identify(identified);

    expect(world.sent).toEqual(['set lamp toggle; sleep 1; set lamp toggle']);
    expect(identified).toHaveBeenCalledOnce();
  });

  it('identifies a hue device with a command that lacks a space', () => {
    const world = createWorld();
    const accessory = world.accessory(device({
      Internals: { NAME: 'bulb', TYPE: 'HUEDevice' }, Readings: { state: 'on', onoff: '1' }, PossibleSets: 'on off toggle alert',
    }));

    accessory.identify(() => undefined);

    expect(world.sent).toEqual(['set bulbalert select']);
  });

  it('does not identify a device that can not toggle', () => {
    const world = createWorld();
    const accessory = world.accessory(device({ Internals: { NAME: 'lamp' }, Readings: { state: 'on' }, PossibleSets: 'on off' }));
    const identified = vi.fn();

    accessory.identify(identified);

    expect(world.sent).toEqual([]);
    expect(identified).toHaveBeenCalledOnce();
  });

  it('knows two commands that are given by name instead of by mapping', () => {
    const world = createWorld();
    const accessory = world.accessory(device({
      Internals: { NAME: 'bulb', TYPE: 'HUEDevice' }, Readings: { state: 'on', onoff: '1', hue: '100', sat: '10', bri: '100' },
      PossibleSets: 'on off bri hue:colorpicker,HUE,0,1,65535 sat:slider,0,1,254',
    }));

    accessory.command('xhue', 180);
    accessory.command('xsat', 50);

    expect(world.sent).toEqual(['set bulb hue 32859', 'set bulb sat 127']);
    expect(() => {
      accessory.command('other', 1);
    }).toThrow(TypeError);
  });

  it('sends nothing when a converter leaves the value unchanged or fails', () => {
    const world = createWorld({
      jsFunctions: {
        unchanged: () => undefined,
        fails: () => {
          throw new Error('boom');
        },
      },
    });
    const accessory = world.accessory(device({
      Internals: { NAME: 'd' }, Readings: { a: '1', b: '1' }, PossibleSets: 'a b',
      Attributes: { genericDeviceType: 'light', homebridgeMapping: 'Brightness=a,cmd=a,homekit2reading=unchanged\nSaturation=b,cmd=b,homekit2reading=fails' },
    }));

    accessory.command(accessory.mappings.Brightness as Mapping, 5);
    accessory.command(accessory.mappings.Saturation as Mapping, 5);

    expect(world.sent).toEqual([]);
    expect(world.log.errors()).toEqual(['error d-b homekit2reading: Error: boom']);
  });
});

describe('rooms, types and scopes', () => {
  const inRooms = (room?: string) => createWorld().accessory(device({
    Internals: { NAME: 'lamp' }, Readings: { state: 'on' }, PossibleSets: 'on off', Attributes: room === undefined ? {} : { room },
  }));

  it('finds an accessory in each of its rooms, ignoring the case of the room it has', () => {
    const accessory = inRooms('Wohnzimmer,Licht');

    expect(accessory.isInRoom('wohnzimmer')).toBe(true);
    expect(accessory.isInRoom('licht')).toBe(true);
    expect(accessory.isInRoom('Licht')).toBe(false);
    expect(accessory.isInRoom('wohn')).toBe(false);
    expect(accessory.isInRoom(undefined)).toBe(false);
    expect(inRooms().isInRoom('licht')).toBe(false);
    expect(inRooms('Bad').isInRoom('bad')).toBe(true);
  });

  it('is of the type of its service', () => {
    const accessory = inRooms();

    expect(accessory.isOfType('switch')).toBe(true);
    expect(accessory.isOfType('light')).toBe(false);
    expect(accessory.isOfType(undefined)).toBe(false);
  });

  it('is in every scope unless the platform names scopes', () => {
    const accessory = inRooms();
    expect(accessory.isInScope('siri')).toBe(true);

    accessory.fhem = {};
    expect(accessory.isInScope('siri')).toBe(true);

    accessory.fhem = { scope: 'alexa,siri' };
    expect(accessory.isInScope('siri')).toBe(true);
    expect(accessory.isInScope('google')).toBe(false);
  });

  it('fails when the scope of the platform is a list', () => {
    const accessory = inRooms();
    accessory.fhem = { scope: ['siri'] };

    expect(() => accessory.isInScope('siri')).toThrow(TypeError);
  });
});

describe('subscriptions', () => {
  it('does not create a second accessory for a device that is published', () => {
    const world = createWorld();
    world.accessory(lamp()).getServices();

    const second = world.accessory(lamp());

    expect(second.mappings).toBeUndefined();
    expect(second.service_name).toBeUndefined();
    expect(world.log.lines.at(-1)).toBe('warn lamp is already published');
    expect(world.published('lamp')).not.toBeNull();
    expect(world.published('other')).toBeNull();
  });

  it('subscribes every characteristic to its reading', () => {
    const world = createWorld();
    const accessory = world.accessory(device({
      Internals: { NAME: 'dimmer', TYPE: 'CUL_HM', DEF: '123456' }, Readings: { pct: '10', state: '10' }, PossibleSets: 'on off pct',
    }));
    accessory.getServices();

    expect(world.subscriptions['dimmer-pct']?.map((subscription) => subscription.characteristic?.displayName)).toEqual(['On', 'Brightness']);
  });

  it('unsubscribes a single characteristic', () => {
    const world = createWorld();
    const accessory = world.accessory(device({
      Internals: { NAME: 'dimmer', TYPE: 'CUL_HM', DEF: '123456' }, Readings: { pct: '10', state: '10' }, PossibleSets: 'on off pct',
    }));
    const service = serviceOf(accessory.getServices(), 'Lightbulb');

    accessory.unsubscribe(accessory.mappings.On as Mapping, characteristicOf(service, Characteristic.On));
    expect(world.subscriptions['dimmer-pct']?.map((subscription) => subscription.characteristic?.displayName)).toEqual(['Brightness']);

    accessory.unsubscribe('dimmer-pct', characteristicOf(service, Characteristic.Brightness));
    expect(world.subscriptions['dimmer-pct']).toBeUndefined();
  });

  it('can subscribe to a reading by its id alone', () => {
    const world = createWorld();
    const accessory = world.accessory(lamp());

    accessory.subscribe('lamp-other');

    expect(world.subscriptions['lamp-other']).toHaveLength(1);
    expect(() => {
      world.update('lamp-other', 'x');
    }).not.toThrow();
  });

  it('seeds hue, saturation and brightness from the xy colour of a light in xy mode', () => {
    const world = createWorld();
    const accessory = world.accessory(device({
      Internals: { NAME: 'bulb', TYPE: 'HUEDevice' },
      Readings: { state: 'on', onoff: '1', bri: '254', hue: '8418', sat: '140', xy: '0.4573,0.41', colormode: 'xy' },
      PossibleSets: 'on off bri hue sat xy',
    }));
    accessory.getServices();

    expect(world.cached['bulb-h']).toBeCloseTo(0.1117, 4);
    expect(world.cached['bulb-s']).toBeCloseTo(0.7137, 4);
    expect(world.cached['bulb-v']).toBe(1);
  });
});
