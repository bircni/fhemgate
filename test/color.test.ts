// the colour conversions between what fhem reports and hue, saturation and brightness
import { describe, expect, it } from 'vitest';
import { device as fhemDevice } from './support/devices.ts';
import { characteristicOf, read, serviceOf, write } from './support/homekit.ts';
import { color, createWorld, hap, sortByKey } from './support/subject.ts';

describe('rgb2hex', () => {
  it('formats three components or a list of them as six hex digits', () => {
    expect(color.rgb2hex(255, 128, 0)).toBe('ff8000');
    expect(color.rgb2hex(0, 0, 0)).toBe('000000');
    expect(color.rgb2hex([1, 2, 3])).toBe('010203');
  });

  it('limits every component to a byte', () => {
    expect(color.rgb2hex(256, 0, 0)).toBe('ff0000');
    expect(color.rgb2hex(-1, 0, 0)).toBe('000000');
    expect(color.rgb2hex([0, 300, -20])).toBe('00ff00');
    expect(color.rgb2hex(12.4, 12.5, NaN)).toBe('0c0d00');
  });
});

describe('hsv2rgb', () => {
  it.each([
    [0, 0, 0, '000000'],
    [0, 0, 1, 'ffffff'],
    [0, 0, 0.5, '808080'],
    [0, 1, 1, 'ff0000'],
    [1 / 6, 1, 1, 'ffff00'],
    [2 / 6, 1, 1, '00ff00'],
    [3 / 6, 1, 1, '00ffff'],
    [4 / 6, 1, 1, '0000ff'],
    [5 / 6, 1, 1, 'ff00ff'],
    [1, 1, 1, 'ff0000'],
    [0.0833, 0.5, 0.8, 'cc9966'],
    [0.6, 0.25, 0.4, '4d5766'],
  ])('h=%f s=%f v=%f is %s', (h, s, v, hex) => {
    expect(color.hsv2rgb(h, s, v)).toBe(hex);
  });
});

describe('rgb2hsv', () => {
  it.each([
    ['000000', [0, 0, 0]],
    ['ffffff', [0, 0, 1]],
    ['ff0000', [0, 1, 1]],
    ['00ff00', [1 / 3, 1, 1]],
    ['0000ff', [2 / 3, 1, 1]],
    ['ff8000', [0.0837, 1, 1]],
    ['ff0080', [0.9163, 1, 1]],
    ['336699', [0.5833, 0.6667, 0.6]],
  ] as [string, [number, number, number]][])('%s', (hex, [h, s, v]) => {
    const hsv = color.rgb2hsv(hex);

    expect(hsv?.[0]).toBeCloseTo(h, 4);
    expect(hsv?.[1]).toBeCloseTo(s, 4);
    expect(hsv?.[2]).toBeCloseTo(v, 4);
  });

  it('takes three components between 0 and 1 as well', () => {
    expect(color.rgb2hsv(1, 0, 0)).toEqual([0, 1, 1]);
    expect(color.rgb2hsv(0.5, 0.5, 0.5)).toEqual([0, 0, 0.5]);
  });

  it('answers nothing without a colour', () => {
    expect(color.rgb2hsv()).toBeUndefined();
  });

  it('has no hue for something that is not a colour', () => {
    expect(color.rgb2hsv('on')).toEqual([undefined, NaN, NaN]);
  });
});

describe('xyY2rgb', () => {
  it.each([
    ['0.4573', '0.41', 'ffc349'],
    ['0.3127', '0.3290', 'def2fe'],
    ['0.7', '0.3', 'f11303'],
    ['0.17', '0.7', '5bff25'],
    ['0.15', '0.06', '0a0cf9'],
    ['0.5', '0', '000000'],
  ])('x=%s y=%s is %s', (x, y, hex) => {
    expect(color.xyY2rgb(x, y, 1)).toBe(hex);
  });
});

describe('ct2rgb', () => {
  it('converts a colour temperature at or above 5600 kelvin', () => {
    expect(color.ct2rgb(5600)).toBe('ffffff');
    expect(color.ct2rgb(6500)).toBe('e6ebff');
    expect(color.ct2rgb(9000)).toBe('cadaff');
  });

  it('takes values up to 1000 as mired', () => {
    expect(color.ct2rgb(153)).toBe('e5eaff');
    expect(color.ct2rgb(178)).toBe('fffbff');
  });

  it('takes green away as the light gets colder', () => {
    expect(color.ct2rgb(10000)).toBe('c4d6ff');
    expect(color.ct2rgb(20000)).toBe('a9c5ff');
  });

  it('takes blue away as the light gets warmer, below 5600 kelvin', () => {
    expect(color.ct2rgb(5500)).toBe('fffefa');
    expect(color.ct2rgb(4000)).toBe('ffe4ce');
    expect(color.ct2rgb(2700)).toBe('ffc697');
    expect(color.ct2rgb(366)).toBe('ffc799');
    expect(color.ct2rgb('366')).toBe('ffc799');
    expect(color.ct2rgb(2000)).toBe('ffb16e');
  });

  it('stays within a byte for the warmest light', () => {
    expect(color.ct2rgb(1000)).toBe('ff890e');
    expect(color.ct2rgb(1001)).toBe('ff890e');
  });
});

describe('a light that is set with rgb and has not reported a colour yet', () => {
  const { Hue, Saturation, Brightness } = hap.Characteristic;
  const strip = () => fhemDevice({ Internals: { NAME: 'strip' }, Readings: { state: 'on' }, PossibleSets: 'on off rgb:colorpicker,RGB' });

  it('is set to the colour HomeKit asks for at full saturation and brightness, also after fhem was asked for the colour it has', () => {
    // fhem answers with nothing when it is asked for a reading the device does not have
    const world = createWorld({ respond: () => '' });
    const light = serviceOf(world.accessory(strip()).getServices(), 'Lightbulb');

    // homebridge reads every characteristic when it lists its accessories
    for (const type of [Hue, Saturation, Brightness]) {
      read(characteristicOf(light, type));
    }
    write(characteristicOf(light, Hue), 120);

    expect(world.sent.at(-1)).toBe('set strip rgb 00ff00');
  });

  it('is published and read without a word in the log', () => {
    const world = createWorld({ respond: () => '' });
    const light = serviceOf(world.accessory(strip()).getServices(), 'Lightbulb');

    for (const type of [Hue, Saturation, Brightness]) {
      read(characteristicOf(light, type));
    }

    expect(world.log.errors()).toEqual([]);
  });

  it('reports a reading that is no colour, and keeps the colour it had worked out before', () => {
    const world = createWorld();
    const light = serviceOf(world.accessory({ ...strip(), Readings: { rgb: { Value: '0000ff', Time: '2026-08-16 12:00:00' } } }).getServices(), 'Lightbulb');

    world.update('strip-rgb', 'on');
    write(characteristicOf(light, Saturation), 50);

    expect(world.log.errors()).toContain('error strip-rgb not a number: on');
    // still blue, with half of its saturation
    expect(world.sent.at(-1)).toBe('set strip rgb 8080ff');
  });
});

describe('sortByKey', () => {
  it('sorts in place by the given key', () => {
    const devices = [{ Name: 'b' }, { Name: 'a' }, { Name: 'B' }, { Name: 'a' }];

    expect(sortByKey(devices, 'Name')).toBe(devices);
    expect(devices.map((device) => device.Name)).toEqual(['B', 'a', 'a', 'b']);
  });
});
