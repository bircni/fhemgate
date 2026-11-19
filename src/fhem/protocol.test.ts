import { describe, expect, it } from 'vitest';
import { commandUrl, devicesUrl, longpollUrl, parseEventLine, reconnectDelayAfterEnd, retryDelayAfterError } from './protocol.ts';

const fhem = 'http://fhem:8083/fhem';

describe('urls', () => {
  it('ask for all events since the last one that was seen', () => {
    expect(longpollUrl('http://fhem:8083/fhem', undefined, 17)).toBe(
      'http://fhem:8083/fhem?XHR=1&inform=type=status;addglobal=1;filter=.*;since=null;fmt=JSON&timestamp=17');
    expect(longpollUrl('http://fhem:8083/fhem', 1786881600500, 17)).toContain(';since=1786881600.5;');
  });

  it('carry a command and the csrf token', () => {
    expect(commandUrl('http://fhem:8083/fhem', 'set lamp on', 'csrf_1')).toBe('http://fhem:8083/fhem?cmd=set%20lamp%20on&fwcsrf=csrf_1&XHR=1');
    expect(commandUrl(fhem, '{ReadingsVal("a","b","")}', '')).toBe(fhem + '?cmd=%7BReadingsVal(%22a%22,%22b%22,%22%22)%7D&XHR=1');
  });

  it('encode the devspec of the device list completely, unlike a command', () => {
    expect(devicesUrl(fhem, 'room=A&B,TYPE=x', 'csrf_1')).toBe(fhem + '?cmd=jsonlist2%20room%3DA%26B%2CTYPE%3Dx&fwcsrf=csrf_1&XHR=1');
    expect(devicesUrl('http://fhem:8083/fhem', undefined, undefined)).toBe('http://fhem:8083/fhem?cmd=jsonlist2&XHR=1');
  });
});

describe('parseEventLine', () => {
  it('reads a JSON line and the older format', () => {
    const event = { informId: 'lamp-state', device: 'lamp', reading: 'state', value: 'on' };

    expect(parseEventLine('["lamp-state","on","<div>on</div>"]')).toEqual(event);
    expect(parseEventLine('lamp-state<<on<<<div>on</div>')).toEqual(event);
  });

  it('splits the id at the first dash', () => {
    expect(parseEventLine('["eg-lamp-state","on",""]')).toMatchObject({ informId: 'eg-lamp-state', device: 'eg', reading: 'lamp-state' });
  });

  it.each([
    ['a timestamp', '["lamp-state-ts","2026-08-16 12:00:00",""]'],
    ['an event for the web frontend', '["#FHEMWEB:WEB","x",""]'],
    ['an id without a dash', '["lamp","on",""]'],
    ['the echo of a set command', '["lamp-state","set-on",""]'],
    ['a line with two parts', '["lamp-state","on"]'],
    ['a line with two parts in the older format', 'lamp-state<<on'],
    ['broken JSON', '[broken'],
  ])('answers nothing for %s', (_what, line) => {
    expect(parseEventLine(line)).toBeUndefined();
  });

  it('fails for a value that is not text', () => {
    expect(() => parseEventLine('["lamp-state",1,""]')).toThrow(TypeError);
  });
});

describe('pauses before the long poll is opened again', () => {
  it('grow from 200 milliseconds to half a minute after it ended', () => {
    expect([1, 2, 10, 61, 100].map(reconnectDelayAfterEnd)).toEqual([200, 700, 4700, 30000, 30000]);
  });

  it('grow from 3 seconds to half a minute after it failed', () => {
    expect([1, 2, 4, 10, 11].map(retryDelayAfterError)).toEqual([3000, 6000, 12000, 30000, 30000]);
  });
});
