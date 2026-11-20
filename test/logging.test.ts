// what a user sees in the homebridge log at its usual level. HomeKit reads every characteristic
// whenever somebody opens the Home app, and fhem sends events all day, so neither may write a line.
import { describe, expect, it, vi } from 'vitest';
import { device } from './support/devices.ts';
import { characteristicOf, read, serviceOf, write } from './support/homekit.ts';
import { createWorld, hap } from './support/subject.ts';

const { Characteristic } = hap;

const dimmer = () =>
  device({ Internals: { NAME: 'dimmer', TYPE: 'CUL_HM', DEF: '123456' }, Readings: { pct: '10', state: '10' }, PossibleSets: 'on off pct:slider,0,1,100' });

describe('the log at the usual level', () => {
  it('has one line for a device at startup', () => {
    const world = createWorld();

    world.accessory(dimmer()).getServices();

    expect(world.log.lines).toEqual(['log dimmer is light']);
  });

  it('has the details of a device for debugging', () => {
    const world = createWorld();

    world.accessory(dimmer()).getServices();

    expect(world.log.debugLines).toEqual(
      expect.arrayContaining([
        'dimmer has',
        '  On [pct;on,off]',
        '  Brightness [pct]',
        'creating services for dimmer',
        '  Lightbulb service for dimmer',
        '    Brightness characteristic for dimmer:pct',
      ]),
    );
  });

  it('has no line for a read, an event or the question to fhem behind a read, and nothing is printed past the logger', () => {
    const world = createWorld({ respond: () => '20' });
    const services = world.accessory(dimmer()).getServices();
    const brightness = characteristicOf(serviceOf(services, 'Lightbulb'), Characteristic.Brightness);
    world.log.clear();
    vi.mocked(console.log).mockClear();

    read(brightness);
    world.update('dimmer-pct', '30');
    world.update('dimmer-pct', '40');

    expect(world.log.lines).toEqual([]);
    expect(world.log.debugLines).toEqual(expect.arrayContaining(['query: Brightness for dimmer-pct', '  cached: 10 (as number)', 'caching: dimmer-pct: 30']));
    expect(console.log).not.toHaveBeenCalled();
  });

  it('still says what HomeKit writes', () => {
    const world = createWorld();
    const services = world.accessory(dimmer()).getServices();
    world.log.clear();

    write(characteristicOf(serviceOf(services, 'Lightbulb'), Characteristic.On), false);

    expect(world.log.lines).toEqual(['info dimmer: executing set cmd for On with value false']);
  });
});
