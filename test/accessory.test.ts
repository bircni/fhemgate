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
  it('answers with the value cached from the reading at once, and asks fhem for it in the background', () => {
    const world = createWorld();
    const services = world.accessory(lamp()).getServices();

    const result = read(characteristicOf(serviceOf(services, 'Switch'), Characteristic.On));

    expect(result).toEqual({ error: undefined, value: true, answered: true });
    expect(world.sent).toEqual(['{ReadingsVal("lamp","state","")}']);
  });

  it('asks fhem in the background at most once a minute for a reading, however often HomeKit reads it', () => {
    vi.useFakeTimers();
    const world = createWorld();
    const on = characteristicOf(serviceOf(world.accessory(lamp()).getServices(), 'Switch'), Characteristic.On);

    read(on);
    read(on);
    vi.advanceTimersByTime(59_999);
    read(on);
    expect(world.sent).toHaveLength(1);

    vi.advanceTimersByTime(1);
    read(on);
    expect(world.sent).toHaveLength(2);
  });

  it('takes over what fhem answers in the background when the cache missed a change', () => {
    const world = createWorld({ respond: () => 'off' });
    const on = characteristicOf(serviceOf(world.accessory(lamp()).getServices(), 'Switch'), Characteristic.On);

    // the read itself is answered from the cache
    expect(read(on).value).toBe(true);

    expect(world.cached['lamp-state']).toBe('off');
    expect(on.value).toBe(false);
  });

  it('keeps the cached value when fhem answers in the background with nothing, as it does for a reading it does not have', () => {
    const world = createWorld({ respond: () => '' });
    const on = characteristicOf(serviceOf(world.accessory(lamp()).getServices(), 'Switch'), Characteristic.On);

    read(on);

    expect(world.cached['lamp-state']).toBe('on');
    expect(on.value).toBe(true);
  });

  it('drops the answer to a background question when an event arrived meanwhile, which is newer', () => {
    const world = createWorld();
    const accessory = world.accessory(lamp());
    const on = characteristicOf(serviceOf(accessory.getServices(), 'Switch'), Characteristic.On);
    let answer: ((result: string) => void) | undefined;
    accessory.execute = (_cmd, callback) => {
      answer = callback;
    };

    read(on);
    world.update('lamp-state', 'standby');
    answer?.('on');

    expect(world.cached['lamp-state']).toBe('standby');
  });

  it('asks fhem when the mapping is not cached', () => {
    const world = createWorld({ respond: () => 'off' });
    const accessory = world.accessory(
      device({
        Internals: { NAME: 'lamp' },
        Readings: { state: 'on' },
        PossibleSets: 'on off',
        Attributes: { homebridgeMapping: 'On=state,nocache=1,cmdOn=on,cmdOff=off' },
      }),
    );
    const services = accessory.getServices();

    const result = read(characteristicOf(serviceOf(services, 'Switch'), Characteristic.On));

    expect(world.sent).toEqual(['{ReadingsVal("lamp","state","")}']);
    expect(result).toEqual({ error: undefined, value: false, answered: true });
    expect(world.cached['lamp-state']).toBe('off');
  });

  it('answers with an error when fhem returns something the mapping can not convert', () => {
    const world = createWorld({ respond: () => 'set-on' });
    const accessory = world.accessory(
      device({
        Internals: { NAME: 'lamp' },
        Readings: { state: 'on' },
        PossibleSets: 'on off',
        Attributes: { homebridgeMapping: 'On=state,nocache=1' },
      }),
    );
    const services = accessory.getServices();

    expect(read(characteristicOf(serviceOf(services, 'Switch'), Characteristic.On))).toEqual({ error: 1, value: undefined, answered: true });
  });

  const uncached = () =>
    device({
      Internals: { NAME: 'lamp' },
      Readings: { state: 'on' },
      PossibleSets: 'on off',
      Attributes: { homebridgeMapping: 'On=state,nocache=1' },
    });

  it('answers with the last value after two seconds when fhem does not answer, well before homebridge calls the plugin slow', () => {
    vi.useFakeTimers();
    const world = createWorld();
    const accessory = world.accessory(uncached());

    const result = read(characteristicOf(serviceOf(accessory.getServices(), 'Switch'), Characteristic.On));
    vi.advanceTimersByTime(1999);
    expect(result.answered).toBe(false);

    vi.advanceTimersByTime(1);
    expect(result).toEqual({ error: undefined, value: true, answered: true });
    expect(world.log.errors()).toEqual([]);
  });

  it('answers with an error after two seconds when fhem does not answer and there never was a value', () => {
    vi.useFakeTimers();
    const world = createWorld();
    const accessory = world.accessory(
      device({
        Internals: { NAME: 'sensor' },
        Readings: { state: 'ok' },
        Attributes: { genericDeviceType: 'thermometer', homebridgeMapping: 'CurrentTemperature=temp' },
      }),
    );

    const result = read(characteristicOf(serviceOf(accessory.getServices(), 'TemperatureSensor'), Characteristic.CurrentTemperature));
    vi.advanceTimersByTime(1999);
    expect(result.answered).toBe(false);

    vi.advanceTimersByTime(1);
    expect(result).toEqual({ error: hap.HAPStatus.OPERATION_TIMED_OUT, value: undefined, answered: true });
    expect(world.log.errors()).toEqual(['error query: no answer from fhem for sensor-temp within 2 seconds']);
  });

  it('answers once: an answer of fhem that comes after the two seconds is published as a change', () => {
    vi.useFakeTimers();
    const world = createWorld();
    const accessory = world.accessory(uncached());
    const on = characteristicOf(serviceOf(accessory.getServices(), 'Switch'), Characteristic.On);
    let late: ((result: string) => void) | undefined;
    accessory.execute = (_cmd, answer) => {
      late = answer;
    };
    const answered = vi.fn();

    accessory.query(accessory.mappings.On as Mapping, answered);
    vi.advanceTimersByTime(2000);
    late?.('off');

    expect(answered).toHaveBeenCalledExactlyOnceWith(undefined, true);
    expect(world.cached['lamp-state']).toBe('off');
    expect(on.value).toBe(false);
  });

  it('does not wait for the two seconds when fhem answers', () => {
    vi.useFakeTimers();
    const world = createWorld({ respond: () => 'off' });
    const accessory = world.accessory(
      device({
        Internals: { NAME: 'lamp' },
        Readings: { state: 'on' },
        PossibleSets: 'on off',
        Attributes: { homebridgeMapping: 'On=state,nocache=1' },
      }),
    );
    const answered = vi.fn();

    accessory.query(accessory.mappings.On as Mapping, answered);
    vi.advanceTimersByTime(10000);

    expect(answered).toHaveBeenCalledExactlyOnceWith(undefined, false);
    expect(vi.getTimerCount()).toBe(0);
  });

  it('answers a mapping that has only a default with that default, without asking fhem or subscribing to a reading', () => {
    const world = createWorld();
    const accessory = world.accessory(
      device({
        Internals: { NAME: 'lamp' },
        Readings: { state: 'on' },
        PossibleSets: 'on off',
        Attributes: { homebridgeMapping: 'StatusActive=default=1' },
      }),
    );
    const services = accessory.getServices();
    world.sent.length = 0;

    const result = read(characteristicOf(serviceOf(services, 'Switch'), Characteristic.StatusActive));

    expect(result).toEqual({ error: undefined, value: 1, answered: true });
    expect(world.sent).toEqual([]);
    expect(accessory.mappings.StatusActive as Mapping).not.toHaveProperty('informId');
    expect(Object.keys(world.subscriptions)).toEqual(['lamp-state']);
    expect(world.log.debugLines).toContain('  StatusActive [default 1]');
  });

  it('answers unreachable for a device that is not reachable, and normally once it is again', () => {
    const world = createWorld();
    const accessory = world.accessory(
      device({
        Internals: { NAME: 'bulb', TYPE: 'HUEDevice' },
        Readings: { state: 'on', reachable: '0' },
        PossibleSets: 'on off',
      }),
    );
    const on = characteristicOf(serviceOf(accessory.getServices(), 'Switch'), Characteristic.On);

    expect((accessory.mappings.Reachable as Mapping).cached).toBe(false);
    expect(world.subscriptions['bulb-reachable']).toHaveLength(1);
    expect(read(on)).toEqual({ error: 'unreachable', value: undefined, answered: true });

    world.update('bulb-reachable', '1');
    expect(read(on)).toEqual({ error: undefined, value: true, answered: true });

    world.update('bulb-reachable', '0');
    expect(read(on)).toEqual({ error: 'unreachable', value: undefined, answered: true });
  });

  it('answers normally for a device that is reachable', () => {
    const world = createWorld();
    const accessory = world.accessory(
      device({
        Internals: { NAME: 'bulb', TYPE: 'HUEDevice' },
        Readings: { state: 'on', reachable: '1' },
        PossibleSets: 'on off',
      }),
    );

    expect(read(characteristicOf(serviceOf(accessory.getServices(), 'Switch'), Characteristic.On))).toEqual({ error: undefined, value: true, answered: true });
    expect((accessory.mappings.Reachable as Mapping).cached).toBe(true);
  });

  it('answers unreachable for every characteristic once the reachable mapping is cached as false', () => {
    const world = createWorld();
    const accessory = world.accessory(
      device({
        Internals: { NAME: 'bulb', TYPE: 'HUEDevice' },
        Readings: { state: 'on', reachable: '0' },
        PossibleSets: 'on off',
      }),
    );
    const services = accessory.getServices();
    (accessory.mappings.Reachable as Mapping).cached = false;

    expect(read(characteristicOf(serviceOf(services, 'Switch'), Characteristic.On))).toEqual({ error: 'unreachable', value: undefined, answered: true });
  });

  it('answers a value that stands for a name', () => {
    const world = createWorld();
    const accessory = world.accessory(
      device({
        Internals: { NAME: 'door', TYPE: 'CUL_FHTTK', DEF: 'abc' },
        Readings: { Window: 'Open', state: 'Open' },
      }),
    );
    const sensor = serviceOf(accessory.getServices(), 'ContactSensor');
    world.log.clear();

    expect(read(characteristicOf(sensor, Characteristic.ContactSensorState)).value).toBe(1);
    expect(world.log.lines).toEqual([]);
    expect(world.log.debugLines).toEqual(['query: ContactSensorState for door-Window', '  cached: 1 (as number; means CONTACT_NOT_DETECTED)']);
  });

  it('asks fhem for a reading given by its name and answers its text', () => {
    const world = createWorld({ respond: () => '42' });
    const accessory = world.accessory(lamp());
    const answered = vi.fn();
    world.log.clear();

    expect(accessory.query('level', answered)).toBeUndefined();

    expect(world.sent).toEqual(['{ReadingsVal("lamp","level","")}']);
    expect(answered).toHaveBeenCalledExactlyOnceWith(undefined, '42');
    expect(world.cached['lamp-level']).toBe('42');
    expect(world.cached).not.toHaveProperty('undefined');
    expect(world.log.lines).toEqual([]);
    expect(world.log.debugLines).toEqual(['query: level for lamp-level', '  not cached', '  value: 42']);
  });

  it('answers 1 as error when there is neither a reading nor a default', () => {
    const world = createWorld();
    const accessory = world.accessory(lamp());
    const answered = vi.fn();

    expect(accessory.query({}, answered)).toBeUndefined();

    expect(answered).toHaveBeenCalledWith(1);
    expect(world.sent).toEqual([]);
  });

  it('answers the name with the siriName', () => {
    const world = createWorld();
    const accessory = world.accessory(
      device({
        Internals: { NAME: 'lamp' },
        Readings: { state: 'on' },
        PossibleSets: 'on off',
        Attributes: { alias: 'Lampe', siriName: 'Stehlampe' },
      }),
    );
    const name = characteristicOf(serviceOf(accessory.getServices(), 'AccessoryInformation'), Characteristic.Name);

    expect(read(name)).toEqual({ error: null, value: 'Stehlampe', answered: true });
    expect(write(name, 'Anders').answered).toBe(true);
    expect(accessory.siriName).toBe('Stehlampe');
    expect(world.sent).toEqual([]);
  });

  it('shows manufacturer, model and serial number as their mappings give them: as text, a default or a reading', () => {
    const world = createWorld();
    const accessory = world.accessory(
      device({
        Internals: { NAME: 'plug' },
        Readings: { state: 'on', typ: 'P-100' },
        PossibleSets: 'on off',
        Attributes: { homebridgeMapping: 'Manufacturer=value=ACME+Corp Model=typ SerialNumber=default=4711' },
      }),
    );
    const information = serviceOf(accessory.getServices(), 'AccessoryInformation');

    expect(characteristicOf(information, Characteristic.Manufacturer).value).toBe('ACME Corp');
    expect(characteristicOf(information, Characteristic.Model).value).toBe('P-100');
    expect(characteristicOf(information, Characteristic.SerialNumber).value).toBe('4711');
  });

  it('answers the firmware revision from its reading', () => {
    const world = createWorld();
    const accessory = world.accessory(
      device({
        Internals: { NAME: 'plug', TYPE: 'ZWave', DEF: 'c1 2' },
        Readings: { state: 'on', firmware: '3.2' },
        PossibleSets: 'on off',
      }),
    );
    const firmware = characteristicOf(serviceOf(accessory.getServices(), 'AccessoryInformation'), Characteristic.FirmwareRevision);

    expect(firmware.value).toBe('3.2');
    expect(read(firmware)).toEqual({ error: undefined, value: '3.2', answered: true });
  });

  const withFirmware = (firmware: string) =>
    device({ Internals: { NAME: 'plug', TYPE: 'ZWave', DEF: 'c1 2' }, Readings: { state: 'on', firmware }, PossibleSets: 'on off' });

  it.each([
    ['3.2', '3.2'],
    ['7', '7'],
    ['1.2.3', '1.2.3'],
    ['1.2.3.4', '1.2.3'],
    ['V2.10', '2.10'],
    ['ZWave+ 4.05 (build 3)', '4.05'],
    ['1.0-beta2', '1.0'],
    ['20190219', '20190219'],
  ])('takes the version out of the firmware reading %j: %s', (reading, version) => {
    const world = createWorld();
    const firmware = characteristicOf(serviceOf(world.accessory(withFirmware(reading)).getServices(), 'AccessoryInformation'), Characteristic.FirmwareRevision);

    expect(firmware.value).toBe(version);
    expect(read(firmware).value).toBe(version);
  });

  it.each(['unknown', 'n/a', '-', 'beta'])('leaves the firmware revision at 0.0.0 when the reading %j holds no version', (reading) => {
    const world = createWorld();
    const firmware = characteristicOf(serviceOf(world.accessory(withFirmware(reading)).getServices(), 'AccessoryInformation'), Characteristic.FirmwareRevision);

    expect(firmware.value).toBe('0.0.0');
    expect(firmware.listenerCount('get')).toBe(0);
    expect(world.log.lines).toContain('warn plug: the firmware reading "' + reading + '" holds no version number. HomeKit is not told a firmware revision.');
  });

  it('follows the firmware reading, and keeps the version it has when the reading holds none', () => {
    const world = createWorld();
    const firmware = characteristicOf(serviceOf(world.accessory(withFirmware('3.2')).getServices(), 'AccessoryInformation'), Characteristic.FirmwareRevision);

    world.update('plug-firmware', 'V3.4 beta');
    expect(firmware.value).toBe('3.4');

    world.update('plug-firmware', 'updating');
    expect(firmware.value).toBe('3.4');
    expect(read(firmware).value).toBe('3.4');
  });

  it('answers a read of a firmware revision that is given with a homebridgeMapping once, and keeps it off the service of the device', async () => {
    const world = createWorld();
    const services = world
      .accessory(
        device({
          Internals: { NAME: 'plug' },
          Readings: { state: 'on', fw: 'fw 1.2.3' },
          PossibleSets: 'on off',
          Attributes: { homebridgeMapping: 'FirmwareRevision=fw SerialNumber=serial=ABC123 Manufacturer=value=ACME' },
        }),
      )
      .getServices();
    const firmware = characteristicOf(serviceOf(services, 'AccessoryInformation'), Characteristic.FirmwareRevision);
    const warnings: string[] = [];
    firmware.on('characteristic-warning', (_type, message) => warnings.push(message));

    // the way HAP-NodeJS reads: every get handler is handed the same callback, which may be called once
    await expect(firmware.handleGetRequest()).resolves.toBe('1.2.3');

    expect(warnings).toEqual([]);
    expect(firmware.listenerCount('get')).toBe(1);
    expect(serviceOf(services, 'Switch').characteristics.map((characteristic) => characteristic.displayName)).toEqual(['Name', 'On']);
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
    const accessory = world.accessory(
      device({
        Internals: { NAME: 'dimmer', TYPE: 'CUL_HM', DEF: '123456' },
        Readings: { pct: '10', state: '10' },
        PossibleSets: 'on off pct',
      }),
    );
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
    const accessory = world.accessory(
      device({
        Internals: { NAME: 'd' },
        Readings: { a: '1', b: '1' },
        PossibleSets: 'a b',
        Attributes: { genericDeviceType: 'light', homebridgeMapping: 'Brightness=a,cmd=a,delay=100\nSaturation=b,cmd=b,delay=2000' },
      }),
    );
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

  it('does not switch on while a delayed command is waiting, but does switch off', () => {
    vi.useFakeTimers();
    const world = createWorld();
    const accessory = world.accessory(
      device({
        Internals: { NAME: 'dimmer', TYPE: 'CUL_HM', DEF: '123456' },
        Readings: { pct: '10', state: '10' },
        PossibleSets: 'on off pct',
      }),
    );
    const service = serviceOf(accessory.getServices(), 'Lightbulb');

    write(characteristicOf(service, Characteristic.Brightness), 20);
    expect(write(characteristicOf(service, Characteristic.On), true).answered).toBe(true);

    expect(world.sent).toEqual([]);
    expect(world.log.lines.at(-1)).toBe('info dimmer: skipping set cmd for On with value true');

    vi.advanceTimersByTime(1000);
    expect(world.sent).toEqual(['set dimmer pct 20']);

    // nothing is waiting any more
    write(characteristicOf(service, Characteristic.On), true);
    write(characteristicOf(service, Characteristic.Brightness), 30);
    write(characteristicOf(service, Characteristic.On), false);
    expect(world.sent).toEqual(['set dimmer pct 20', 'set dimmer on', 'set dimmer off']);
  });

  it('falls back to the default after the timeout of a push button', async () => {
    vi.useFakeTimers();
    const world = createWorld();
    const accessory = world.accessory(
      device({
        Internals: { NAME: 'door', TYPE: 'CUL_HM', DEF: '123456' },
        Readings: { lock: 'locked', state: 'locked' },
        Attributes: { model: 'HM-SEC-KEY' },
        PossibleSets: 'lock unlock open',
      }),
    );
    const target = characteristicOf(serviceOf(accessory.getServices(), 'LockMechanism'), Characteristic.TargetDoorState);
    expect(target.value).toBe(Characteristic.TargetDoorState.CLOSED);

    target.updateValue(Characteristic.TargetDoorState.OPEN);
    write(target, Characteristic.TargetDoorState.OPEN);
    expect(world.sent).toEqual(['set door open']);

    await vi.advanceTimersByTimeAsync(500);
    expect(target.value).toBe(Characteristic.TargetDoorState.CLOSED);
  });
});

describe('the heating state of a thermostat', () => {
  const thermostat = (readings: Record<string, string>) =>
    device({
      Internals: { NAME: 'valve', TYPE: 'CUL_HM', DEF: '123456' },
      Readings: { 'desired-temp': '21.0', 'measured-temp': '19.0', ...readings },
      PossibleSets: 'desired-temp:slider,4.5,0.5,30.5',
    });

  it('follows the valve: off while it is closed, heating while it is open', async () => {
    const world = createWorld();
    const services = world.accessory(thermostat({ actuator: '0' })).getServices();
    const state = characteristicOf(serviceOf(services, 'Thermostat'), Characteristic.CurrentHeatingCoolingState);
    expect(state.value).toBe(Characteristic.CurrentHeatingCoolingState.OFF);

    const seen: unknown[] = [];
    for (const position of ['12', '0 %', '0.5', '0.0', '100']) {
      world.update('valve-actuator', position);
      await settle();
      seen.push(state.value);
    }

    const { OFF, HEAT } = Characteristic.CurrentHeatingCoolingState;
    expect(seen).toEqual([HEAT, OFF, HEAT, OFF, HEAT]);
    expect(world.log.errors()).toEqual([]);
  });

  it('is heating when the thermostat reports no valve position', () => {
    const world = createWorld();
    const accessory = world.accessory(thermostat({}));
    const state = characteristicOf(serviceOf(accessory.getServices(), 'Thermostat'), Characteristic.CurrentHeatingCoolingState);

    expect(accessory.mappings.CurrentHeatingCoolingState).toMatchObject({ default: Characteristic.CurrentHeatingCoolingState.HEAT });
    expect(accessory.mappings.CurrentHeatingCoolingState).not.toHaveProperty('reading');
    expect(read(state)).toEqual({ error: undefined, value: Characteristic.CurrentHeatingCoolingState.HEAT, answered: true });
  });
});

describe('readings without a value in the values list', () => {
  it('are reported once as a warning, however often they arrive', async () => {
    const world = createWorld();
    const accessory = world.accessory(
      device({
        Internals: { NAME: 'door', TYPE: 'MAX', type: 'ShutterContact', addr: 'abc' },
        Readings: { state: 'closed' },
        Attributes: { homebridgeMapping: 'ContactSensorState=values=closed:CONTACT_DETECTED;open:CONTACT_NOT_DETECTED' },
      }),
    );
    const sensor = characteristicOf(serviceOf(accessory.getServices(), 'ContactSensor'), Characteristic.ContactSensorState);
    world.log.clear();

    world.update('door-state', 'tilted');
    world.update('door-state', 'closed');
    world.update('door-state', 'tilted');
    await settle();

    expect(world.log.lines.filter((line) => !line.startsWith('info '))).toEqual(['warn door-state value tilted not handled in values']);
    expect(sensor.value).toBe(0);
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

  it('identifies a hue device by letting it blink once', () => {
    const world = createWorld();
    const accessory = world.accessory(
      device({
        Internals: { NAME: 'bulb', TYPE: 'HUEDevice' },
        Readings: { state: 'on', onoff: '1' },
        PossibleSets: 'on off toggle alert',
      }),
    );

    accessory.identify(() => undefined);

    expect(world.sent).toEqual(['set bulb alert select']);
  });

  it('does not identify a device that can not toggle', () => {
    const world = createWorld();
    const accessory = world.accessory(device({ Internals: { NAME: 'lamp' }, Readings: { state: 'on' }, PossibleSets: 'on off' }));
    const identified = vi.fn();

    accessory.identify(identified);

    expect(world.sent).toEqual([]);
    expect(identified).toHaveBeenCalledOnce();
  });

  it('takes a command that is given by name instead of by mapping', () => {
    const world = createWorld();
    const accessory = world.accessory(
      device({
        Internals: { NAME: 'bulb', TYPE: 'HUEDevice' },
        Readings: { state: 'on', onoff: '1', hue: '100', sat: '10', bri: '100' },
        PossibleSets: 'on off bri hue:colorpicker,HUE,0,1,65535 sat:slider,0,1,254',
      }),
    );

    accessory.command('xhue', 180);
    accessory.command('xsat', 50);

    accessory.command('bri', 100);
    accessory.command('toggle');

    expect(world.sent).toEqual(['set bulb hue 32859', 'set bulb sat 127', 'set bulb bri 100', 'set bulb toggle']);
    expect(world.log.lines.at(-1)).toBe('info bulb sending command toggle with value undefined');
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
    const accessory = world.accessory(
      device({
        Internals: { NAME: 'd' },
        Readings: { a: '1', b: '1' },
        PossibleSets: 'a b',
        Attributes: { genericDeviceType: 'light', homebridgeMapping: 'Brightness=a,cmd=a,homekit2reading=unchanged\nSaturation=b,cmd=b,homekit2reading=fails' },
      }),
    );

    accessory.command(accessory.mappings.Brightness as Mapping, 5);
    accessory.command(accessory.mappings.Saturation as Mapping, 5);

    expect(world.sent).toEqual([]);
    expect(world.log.errors()).toEqual(['error d-b homekit2reading: Error: boom']);
  });
});

describe('javascript in a mapping', () => {
  const doubled = () =>
    device({
      Internals: { NAME: 'd' },
      Readings: { a: '4', b: '4' },
      PossibleSets: 'a b',
      Attributes: {
        genericDeviceType: 'light',
        homebridgeMapping: 'Brightness=a,cmd=a,reading2homekit={return+orig*2},homekit2reading={return+orig/2}\nSaturation=b,cmd=b,reading2homekit=twice',
      },
    });
  const jsFunctions = { twice: (_mapping: Mapping, orig: string) => Number(orig) * 2 };

  it('is run unless the platform says otherwise', () => {
    const world = createWorld({ jsFunctions });
    const accessory = world.accessory(doubled());

    expect((accessory.mappings.Brightness as Mapping).cached).toBe(8);
    accessory.command(accessory.mappings.Brightness as Mapping, 50);
    expect(world.sent).toEqual(['set d a 25']);
    expect(world.log.errors()).toEqual([]);
  });

  it('is refused when the platform does not allow it, while the rest of the mapping and the named functions go on working', () => {
    const world = createWorld({ jsFunctions });
    const accessory = world.accessory(doubled(), { allowInlineFunctions: false });

    expect(world.log.errors()).toEqual([
      'error   reading2homekit: JavaScript in a mapping is refused, as allowInlineFunctions is false for this platform',
      'error   reading2homekit disabled.',
      'error   homekit2reading: JavaScript in a mapping is refused, as allowInlineFunctions is false for this platform',
      'error   homekit2reading disabled.',
    ]);
    expect(accessory.mappings.Brightness).not.toHaveProperty('reading2homekit');
    expect(accessory.mappings.Brightness).not.toHaveProperty('homekit2reading');
    expect((accessory.mappings.Brightness as Mapping).cached).toBe(4);
    expect((accessory.mappings.Saturation as Mapping).cached).toBe(8);
    accessory.command(accessory.mappings.Brightness as Mapping, 50);
    expect(world.sent).toEqual(['set d a 50']);
  });
});

describe('services of the same type', () => {
  const kinds = (services: { constructor: { name: string }; subtype?: string }[]) =>
    services.map((service) => `${service.constructor.name}(${service.subtype ?? ''})`);

  it('are told apart by their subtypes', () => {
    const world = createWorld();
    const accessory = world.accessory(
      device({
        Internals: { NAME: 'strip' },
        Readings: { a: 'on', b: 'off' },
        PossibleSets: 'on off',
        Attributes: { homebridgeMapping: 'clear Outlet(a)#On=a Outlet(b)#On=b' },
      }),
    );

    expect(kinds(accessory.getServices())).toEqual(['AccessoryInformation()', 'Switch()', 'Outlet(a)', 'Outlet(b)']);
    expect(world.log.errors()).toEqual([]);
  });

  it('are not created twice without a subtype: the mapping that asks for it is skipped and the others stay', () => {
    const world = createWorld();
    const accessory = world.accessory(
      device({
        Internals: { NAME: 'strip' },
        Readings: { a: 'on', b: 'off', c: 'on' },
        PossibleSets: 'on off',
        Attributes: { homebridgeMapping: 'clear Outlet(a)#On=a Outlet#OutletInUse=b Lightbulb#On=c' },
      }),
    );

    const services = accessory.getServices();

    expect(kinds(services)).toEqual(['AccessoryInformation()', 'Switch()', 'Outlet(a)', 'Lightbulb()']);
    expect(world.log.errors()).toEqual([
      'error strip: Outlet#OutletInUse needs another Outlet service without a subtype. give it a subtype of its own. the mapping is skipped.',
    ]);
    expect(characteristicOf(serviceOf(services, 'Lightbulb'), Characteristic.On).value).toBe(true);
    // what homebridge does with the services: it takes them all
    const published = new hap.Accessory('strip', hap.uuid.generate('strip'));
    expect(() => {
      for (const service of services.slice(1)) {
        published.addService(service);
      }
    }).not.toThrow();
  });

  it('are not created twice with the same subtype under two names of the service', () => {
    const world = createWorld();
    const accessory = world.accessory(
      device({
        Internals: { NAME: 'strip' },
        Readings: { a: 'on', b: 'off' },
        PossibleSets: 'on off',
        Attributes: { homebridgeMapping: 'clear outlet(a)#On=a Outlet(a)#OutletInUse=b' },
      }),
    );

    expect(kinds(accessory.getServices())).toEqual(['AccessoryInformation()', 'Switch()', 'Outlet(a)']);
    expect(world.log.errors()).toEqual([
      'error strip: Outlet(a)#OutletInUse needs another Outlet service with the subtype a, which another one has. give it a subtype of its own. the mapping is skipped.',
    ]);
  });
});

describe('rooms, types and scopes', () => {
  const inRooms = (room?: string) =>
    createWorld().accessory(
      device({
        Internals: { NAME: 'lamp' },
        Readings: { state: 'on' },
        PossibleSets: 'on off',
        Attributes: room === undefined ? {} : { room },
      }),
    );

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

  it('takes the scopes of the platform as a list as well', () => {
    const accessory = inRooms();

    accessory.fhem = { scope: ['alexa', 'siri'] };
    expect(accessory.isInScope('siri')).toBe(true);
    expect(accessory.isInScope('google')).toBe(false);

    accessory.fhem = { scope: [] };
    expect(accessory.isInScope('siri')).toBe(false);
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
    const accessory = world.accessory(
      device({
        Internals: { NAME: 'dimmer', TYPE: 'CUL_HM', DEF: '123456' },
        Readings: { pct: '10', state: '10' },
        PossibleSets: 'on off pct',
      }),
    );
    accessory.getServices();

    expect(world.subscriptions['dimmer-pct']?.map((subscription) => subscription.characteristic?.displayName)).toEqual(['On', 'Brightness']);
  });

  it('unsubscribes a single characteristic', () => {
    const world = createWorld();
    const accessory = world.accessory(
      device({
        Internals: { NAME: 'dimmer', TYPE: 'CUL_HM', DEF: '123456' },
        Readings: { pct: '10', state: '10' },
        PossibleSets: 'on off pct',
      }),
    );
    const service = serviceOf(accessory.getServices(), 'Lightbulb');

    accessory.unsubscribe(accessory.mappings.On as Mapping, characteristicOf(service, Characteristic.On));
    expect(world.subscriptions['dimmer-pct']?.map((subscription) => subscription.characteristic?.displayName)).toEqual(['Brightness']);

    accessory.unsubscribe('dimmer-pct', characteristicOf(service, Characteristic.Brightness));
    expect(world.subscriptions['dimmer-pct']).toBeUndefined();
  });

  it('unsubscribes everything at once, also for a characteristic with several mappings', () => {
    const world = createWorld();
    const accessory = world.accessory(
      device({
        Internals: { NAME: 'd' },
        Readings: { a: '1', b: '1' },
        PossibleSets: 'on off',
        Attributes: { homebridgeMapping: 'clear On=a On=b,subtype=B' },
      }),
    );
    accessory.getServices();

    expect(Object.keys(world.subscriptions)).toEqual(['d-a', 'd-b']);

    accessory.unsubscribe();

    expect(world.subscriptions).toEqual({});
  });

  it('unsubscribes everything at once, with or without a characteristic, and leaves other accessories alone', () => {
    const world = createWorld();
    const accessory = world.accessory(lamp());
    accessory.getServices();
    accessory.subscribe('lamp-state');
    const other = world.accessory(device({ Internals: { NAME: 'other' }, Readings: { state: 'on' }, PossibleSets: 'on off' }));
    other.getServices();
    other.subscribe('lamp-state');

    accessory.unsubscribe();

    expect(Object.keys(world.subscriptions)).toEqual(['lamp-state', 'other-state']);
    expect(world.subscriptions['lamp-state']?.map((subscription) => subscription.accessory)).toEqual([other]);
    expect(world.published('lamp')).toBeNull();
    expect(world.published('other')).toBe(other);
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
    const accessory = world.accessory(
      device({
        Internals: { NAME: 'bulb', TYPE: 'HUEDevice' },
        Readings: { state: 'on', onoff: '1', bri: '254', hue: '8418', sat: '140', xy: '0.4573,0.41', colormode: 'xy' },
        PossibleSets: 'on off bri hue sat xy',
      }),
    );
    accessory.getServices();

    expect(world.cached['bulb-h']).toBeCloseTo(0.1117, 4);
    expect(world.cached['bulb-s']).toBeCloseTo(0.7137, 4);
    expect(world.cached['bulb-v']).toBe(1);
  });
});

describe('the residents as a security system', () => {
  const residents = (state: string) => device({ Internals: { NAME: 'rr', TYPE: 'RESIDENTS' }, Readings: { state } });
  const { SecuritySystemCurrentState: Current, SecuritySystemTargetState: Target } = Characteristic;

  it('is disarmed in both states when the residents come home', async () => {
    const world = createWorld();
    const system = serviceOf(world.accessory(residents('gone')).getServices(), 'SecuritySystem');
    const current = characteristicOf(system, Current);
    const target = characteristicOf(system, Target);
    expect([current.value, target.value]).toEqual([Current.AWAY_ARM, Target.AWAY_ARM]);
    world.log.clear();

    world.update('rr-state', 'home');
    await settle();

    expect([current.value, target.value]).toEqual([Current.DISARMED, Target.DISARM]);
    expect(world.log.lines.filter((line) => !line.startsWith('info '))).toEqual([]);
  });

  it.each([
    ['home', Current.DISARMED, Target.DISARM],
    ['gotosleep', Current.NIGHT_ARM, Target.NIGHT_ARM],
    ['absent', Current.STAY_ARM, Target.STAY_ARM],
    ['gone', Current.AWAY_ARM, Target.AWAY_ARM],
  ])('shows the state %s as %i and %i', (state, current, target) => {
    const world = createWorld();
    const accessory = world.accessory(residents(state));

    expect((accessory.mappings.SecuritySystemCurrentState as Mapping).cached).toBe(current);
    expect((accessory.mappings.SecuritySystemTargetState as Mapping).cached).toBe(target);
    expect(world.log.errors()).toEqual([]);
  });

  it('only names values and commands its two characteristics have', () => {
    const accessory = createWorld().accessory(residents('home'));

    for (const [type, constants] of [
      ['SecuritySystemCurrentState', Current],
      ['SecuritySystemTargetState', Target],
    ] as const) {
      const mapping = accessory.mappings[type] as Mapping & { values: string[]; cmds?: string[] };
      const named = [...mapping.values.map((pair) => pair.split(':').at(-1)), ...(mapping.cmds ?? []).map((pair) => pair.split(':')[0])];
      for (const name of named) {
        expect(constants, `${type} ${name}`).toHaveProperty(name as string);
      }
    }
  });
});

describe('mappings for the accessory information', () => {
  const plug = () =>
    device({
      Internals: { NAME: 'plug' },
      Readings: { state: 'on', fw: '2.0.1' },
      PossibleSets: 'on off',
      Attributes: { homebridgeMapping: 'Manufacturer=value=ACME Model=value=P-100 SerialNumber=serial=4711 FirmwareRevision=fw' },
    });
  const names = (service: { characteristics: { displayName: string }[] }) => service.characteristics.map((characteristic) => characteristic.displayName);

  it('are shown there and nowhere else', () => {
    const world = createWorld();
    const services = world.accessory(plug()).getServices();
    const information = serviceOf(services, 'AccessoryInformation');

    expect(names(serviceOf(services, 'Switch'))).toEqual(['Name', 'On']);
    expect(characteristicOf(information, Characteristic.Manufacturer).value).toBe('ACME');
    expect(characteristicOf(information, Characteristic.Model).value).toBe('P-100');
    expect(characteristicOf(information, Characteristic.SerialNumber).value).toBe('4711');
    expect(characteristicOf(information, Characteristic.FirmwareRevision).value).toBe('2.0.1');
    expect(Object.fromEntries(Object.entries(world.subscriptions).map(([informId, list]) => [informId, list?.length]))).toEqual({
      'plug-state': 1,
      'plug-fw': 1,
    });
  });

  it('answer a read of the firmware revision once, the way HomeKit reads it', async () => {
    const world = createWorld();
    const information = serviceOf(world.accessory(plug()).getServices(), 'AccessoryInformation');
    const firmware = characteristicOf(information, Characteristic.FirmwareRevision);
    const warned = vi.fn();
    firmware.on('characteristic-warning', warned);

    expect(await firmware.handleGetRequest()).toBe('2.0.1');
    await settle();

    expect(warned).not.toHaveBeenCalled();
    expect(vi.mocked(console.warn).mock.calls.flat().join(' ')).not.toContain('already');
  });

  it('follow the firmware revision when its reading changes', async () => {
    const world = createWorld();
    const information = serviceOf(world.accessory(plug()).getServices(), 'AccessoryInformation');

    world.update('plug-fw', '2.1.0');
    await settle();

    expect(characteristicOf(information, Characteristic.FirmwareRevision).value).toBe('2.1.0');
  });

  it('still become a characteristic of a service that is named for them', () => {
    const world = createWorld();
    const outlet = device({ Internals: { NAME: 'plug' }, Readings: { state: 'on', fw: '2.0.1' }, PossibleSets: 'on off' });
    outlet.Attributes.homebridgeMapping = 'Outlet#FirmwareRevision=fw';

    expect(names(serviceOf(world.accessory(outlet).getServices(), 'Outlet'))).toEqual(['Name', 'On', 'Firmware Revision']);
  });
});

describe('names of services and characteristics', () => {
  const kinds = (services: { constructor: { name: string }; subtype?: string }[]) => services.map((service) => service.constructor.name);
  const switched = (homebridgeMapping: string) =>
    device({
      Internals: { NAME: 'plug' },
      Readings: { state: 'on', level: '15', charging: '1', nr: '2' },
      PossibleSets: 'on off',
      Attributes: { genericDeviceType: 'switch', homebridgeMapping },
    });

  it('are still known by the name HAP-NodeJS had for them before it renamed them, as in the example of the README', () => {
    const world = createWorld();
    const accessory = world.accessory(
      switched(
        'On=state,cmdOn=on,cmdOff=off BatteryService#BatteryLevel=level ' +
          'BatteryService#StatusLowBattery=level,threshold=20,values=0:BATTERY_LEVEL_LOW;1:BATTERY_LEVEL_NORMAL BatteryService#ChargingState=charging',
      ),
    );

    const services = accessory.getServices();

    expect(kinds(services)).toEqual(['AccessoryInformation', 'Switch', 'Battery']);
    const battery = serviceOf(services, 'Battery');
    expect(characteristicOf(battery, Characteristic.BatteryLevel).value).toBe(15);
    expect(characteristicOf(battery, Characteristic.StatusLowBattery).value).toBe(Characteristic.StatusLowBattery.BATTERY_LEVEL_LOW);
    expect(characteristicOf(battery, Characteristic.ChargingState).value).toBe(Characteristic.ChargingState.CHARGING);
    expect(world.log.errors()).toEqual([]);
  });

  it('are known by their older name for characteristics as well, with the names of their values', () => {
    const world = createWorld();
    const accessory = world.accessory(switched('Label#LabelNamespace=nr,values=2:ARABIC_NUMERALS;/.*/:DOTS LabelIndex=nr'));

    const label = serviceOf(accessory.getServices(), 'ServiceLabel');

    expect(characteristicOf(label, Characteristic.ServiceLabelNamespace).value).toBe(Characteristic.ServiceLabelNamespace.ARABIC_NUMERALS);
    expect(characteristicOf(label, Characteristic.ServiceLabelIndex).value).toBe(2);
    expect(world.log.errors()).toEqual([]);
  });

  it.each([
    ['Service', 'BatteryService', 'Battery'],
    ['Service', 'Slat', 'Slats'],
    ['Service', 'Label', 'ServiceLabel'],
    ['Service', 'Relay', 'CloudRelay'],
    ['Service', 'TunneledBTLEAccessoryService', 'Tunnel'],
    ['Service', 'CameraEventRecordingManagement', 'CameraRecordingManagement'],
    ['Characteristic', 'LabelIndex', 'ServiceLabelIndex'],
    ['Characteristic', 'LabelNamespace', 'ServiceLabelNamespace'],
    ['Characteristic', 'PairingPairings', 'ListPairings'],
    ['Characteristic', 'SelectedStreamConfiguration', 'SelectedRTPStreamConfiguration'],
  ] as const)('the %s %s is %s by now', (kind, older, current) => {
    const classes = hap[kind] as unknown as Record<string, unknown>;
    const accessory = createWorld().accessory(switched(''));

    expect(classes[older]).toBeUndefined();
    expect(classes[current]).toBeTypeOf('function');
    expect(kind === 'Service' ? accessory.serviceOfName(older)?.constructor : accessory.characteristicOfName(older)).toBe(classes[current]);
  });

  it('skip a mapping of a switch that names a service HomeKit does not know, so that homebridge takes the accessory', () => {
    const world = createWorld();
    const accessory = world.accessory(switched('On=state,cmdOn=on,cmdOff=off NoSuchService#BatteryLevel=level'));

    const services = accessory.getServices();

    expect(kinds(services)).toEqual(['AccessoryInformation', 'Switch']);
    expect(world.log.errors()).toEqual([
      'error plug: service name NoSuchService unknown',
      'error plug: NoSuchService#BatteryLevel needs another NoSuchService service without a subtype. give it a subtype of its own. the mapping is skipped.',
    ]);
    const published = new hap.Accessory('plug', hap.uuid.generate('plug'));
    expect(() => {
      for (const service of services.slice(1)) {
        published.addService(service);
      }
    }).not.toThrow();
  });
});

describe('a zwave dimmer', () => {
  const dimmer = (state: string) =>
    device({ Internals: { NAME: 'dimmer', TYPE: 'ZWave', DEF: 'c1 2' }, Readings: { state }, PossibleSets: 'on off dim:slider,0,1,99' });

  it.each([
    ['off', false, 0],
    ['dim 0', false, 0],
    ['0', false, 0],
    ['on', true, 0],
    ['dim 40', true, 40],
    ['dim 99', true, 99],
  ])('with the state %j is on: %j, at %d percent', (state, on, brightness) => {
    const light = serviceOf(createWorld().accessory(dimmer(state)).getServices(), 'Lightbulb');

    expect(characteristicOf(light, Characteristic.On).value).toBe(on);
    expect(characteristicOf(light, Characteristic.Brightness).value).toBe(brightness);
  });

  it('goes off in HomeKit when fhem reports off after it was switched off', () => {
    const world = createWorld();
    const light = serviceOf(world.accessory(dimmer('dim 60')).getServices(), 'Lightbulb');

    world.update('dimmer-state', 'off');

    expect(characteristicOf(light, Characteristic.On).value).toBe(false);
  });
});
