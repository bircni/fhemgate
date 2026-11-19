// the homebridgeMapping attribute: how its text becomes mappings
import { describe, expect, it } from 'vitest';
import { device } from './support/devices.ts';
import { createWorld, type World } from './support/subject.ts';
import type { Accessory, Mapping } from './support/types.ts';

/** an accessory with the given mappings, to parse an attribute value into */
function accessoryWith(mappings: Record<string, Mapping | Mapping[]> = {}): { world: World; accessory: Accessory } {
  const world = createWorld();
  const accessory = world.accessory(device({ Readings: { state: 'on' }, PossibleSets: 'on off' }));
  accessory.mappings = mappings;
  world.log.clear();
  return { world, accessory };
}

function parse(homebridgeMapping: string, mappings: Record<string, Mapping | Mapping[]> = {}) {
  const { world, accessory } = accessoryWith(mappings);
  accessory.fromHomebridgeMapping(homebridgeMapping);
  return { mappings: accessory.mappings, log: world.log.lines.slice(1), accessory };
}

describe('entries', () => {
  it('reads characteristic=parameters, separated by blanks or line breaks', () => {
    expect(parse('On=state,cmdOn=an,cmdOff=aus\nBrightness=pct').mappings).toEqual({
      On: { reading: 'state', cmdOn: 'an', cmdOff: 'aus' },
      Brightness: { reading: 'pct' },
    });
  });

  it('takes a colon after the characteristic as well', () => {
    expect(parse('On:state').mappings).toEqual({ On: { reading: 'state' } });
  });

  it('does nothing without a value', () => {
    const { world, accessory } = accessoryWith({ On: { reading: 'state' } });

    accessory.fromHomebridgeMapping(undefined);
    accessory.fromHomebridgeMapping('');

    expect(accessory.mappings).toEqual({ On: { reading: 'state' } });
    expect(world.log.lines).toEqual([]);
  });

  it('logs the attribute before it is parsed', () => {
    const { world, accessory } = accessoryWith();

    accessory.fromHomebridgeMapping('On=state');

    expect(world.log.lines).toEqual(['info homebridgeMapping: On=state']);
  });

  it('changes a mapping that already exists', () => {
    const existing = { reading: 'state', cmdOn: 'on', cmdOff: 'off' };

    const { mappings } = parse('On=cmdOn=an', { On: existing });

    expect(mappings.On).toBe(existing);
    expect(existing).toEqual({ reading: 'state', cmdOn: 'an', cmdOff: 'off' });
  });

  it('collects a characteristic that is given several times in a list', () => {
    expect(parse('On=a On=b On=c').mappings).toEqual({ On: [{ reading: 'a' }, { reading: 'b' }, { reading: 'c' }] });
  });

  it('keeps the detected mapping first when the characteristic is given twice', () => {
    expect(parse('On=a On=b', { On: { reading: 'state' } }).mappings).toEqual({ On: [{ reading: 'a' }, { reading: 'b' }] });
  });

  it('skips comments', () => {
    expect(parse('#On=a Brightness=b').mappings).toEqual({ Brightness: { reading: 'b' } });
  });

  it('reports entries it can not read and goes on', () => {
    const { mappings, log } = parse('On On= Brightness=pct,a=b=c');

    expect(mappings).toEqual({ Brightness: { reading: 'pct' } });
    expect(log).toEqual(['error   wrong syntax: On', 'error   wrong syntax: On=', 'error   wrong syntax: a=b=c']);
  });
});

describe('clear', () => {
  it('drops all mappings so far', () => {
    expect(parse('Brightness=pct clear On=state', { Hue: { reading: 'hue' } }).mappings).toEqual({ On: { reading: 'state' } });
  });

  it('drops one characteristic', () => {
    expect(parse('Hue=clear', { Hue: { reading: 'hue' }, On: { reading: 'state' } }).mappings).toEqual({ On: { reading: 'state' } });
  });

  it('starts a characteristic over when more parameters follow', () => {
    expect(parse('Hue=clear,farbe,cmd=farbe', { Hue: { reading: 'hue', max: 359 } }).mappings).toEqual({ Hue: { reading: 'farbe', cmd: 'farbe' } });
  });
});

describe('parameters', () => {
  it('splits values, cmds and valid into lists', () => {
    expect(parse('X=values=a:1;b:2,cmds=1:a;2:b,valid=1;2').mappings.X).toEqual({
      values: ['a:1', 'b:2'], cmds: ['1:a', '2:b'], valid: ['1', '2'],
    });
  });

  it('reads delay as milliseconds, or as true', () => {
    expect(parse('A=delay=750 B=delay=true C=delay=yes').mappings).toEqual({ A: { delay: 750 }, B: { delay: true }, C: { delay: true } });
  });

  it('reads limits and the default as numbers where they are numbers', () => {
    expect(parse('X=minValue=4.5,maxValue=30,minStep=0.5,min=1,max=255,default=7').mappings.X).toEqual({
      minValue: 4.5, maxValue: 30, minStep: 0.5, min: 1, max: 255, default: 7,
    });
    expect(parse('X=default=CLOSED,max=abc').mappings.X).toEqual({ default: 'CLOSED', max: 'abc' });
  });

  it('keeps every other parameter as text, with + for a blank', () => {
    expect(parse('X=cmdOn=set+on,factor=0.1,invert=1,part=2,threshold=5,nocache=true,timeout=500').mappings.X).toEqual({
      cmdOn: 'set on', factor: '0.1', invert: '1', part: '2', threshold: '5', nocache: 'true', timeout: '500',
    });
  });

  it('does not replace + inside the lists', () => {
    expect(parse('X=cmds=1:set+a').mappings.X).toEqual({ cmds: ['1:set+a'] });
  });

  it('takes a parameter without a name as [cmd:][device:]reading', () => {
    expect(parse('A=temperature B=aussen:temperature C=desired-temp:heizung:temperature').mappings).toEqual({
      A: { reading: 'temperature' },
      B: { device: 'aussen', reading: 'temperature' },
      C: { cmd: 'desired-temp', device: 'heizung', reading: 'temperature' },
    });
  });

  it('copies another characteristic that is named as a parameter', () => {
    const current = { reading: 'pct', invert: true };

    const { mappings } = parse('TargetPosition=CurrentPosition,cmd=pct', { CurrentPosition: current });

    expect(mappings.TargetPosition).toEqual({ reading: 'pct', invert: true, cmd: 'pct' });
    expect(mappings.TargetPosition).not.toBe(current);
    expect(current).toEqual({ reading: 'pct', invert: true });
  });

  it('takes a lone invert for the name of a reading', () => {
    expect(parse('CurrentPosition=pct,invert').mappings.CurrentPosition).toEqual({ reading: 'invert' });
  });
});

describe('services', () => {
  it('keeps the service of an entry for the entries that follow', () => {
    expect(Object.keys(parse('Outlet#On=a Brightness=b Lightbulb#On=c Hue=d').mappings)).toEqual([
      'Outlet#On', 'Outlet#Brightness', 'Lightbulb#On', 'Lightbulb#Hue',
    ]);
  });

  it('copies a characteristic of the same service by its short name', () => {
    const { mappings } = parse('Fan#On=speed Fan#Active=On');

    expect(mappings['Fan#Active']).toEqual({ reading: 'speed' });
  });

  it('does not find a category, as the accessory class of homekit has none any more', () => {
    const { mappings, log, accessory } = parse('AccessoryCategory=FAN');

    expect(mappings).toEqual({});
    expect(accessory.category).toBeUndefined();
    expect(log).toEqual(['error unknown category: FAN']);
  });
});

describe('json', () => {
  it('replaces all mappings with the object', () => {
    const { mappings } = parse('{"On": {"reading": "a", "cmdOn": "x"}, "Hue": [{"reading": "h"}]}', { Brightness: { reading: 'pct' } });

    expect(mappings).toEqual({ On: { reading: 'a', cmdOn: 'x' }, Hue: [{ reading: 'h' }] });
  });

  it('keeps the mappings when the object can not be parsed', () => {
    const { mappings, log } = parse('{"On": nope}', { Brightness: { reading: 'pct' } });

    expect(mappings).toEqual({ Brightness: { reading: 'pct' } });
    expect(log).toHaveLength(1);
    expect(log[0]).toMatch(/^error {3}fromHomebridgeMapping JSON.parse: SyntaxError/);
  });

  it('is only recognised on a single line', () => {
    const { mappings, log } = parse('{"On":\n{"reading":"a"}}');

    expect({ mappings, log }).toMatchSnapshot();
  });
});
