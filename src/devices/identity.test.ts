import { describe, expect, it } from 'vitest';
import { deviceIdentity } from './identity.ts';
import type { Jsonlist2Device } from './types.ts';

const device = (internals: Record<string, string>, rest: Partial<Jsonlist2Device> = {}): Jsonlist2Device => ({
  Internals: { NAME: 'dev_1', TYPE: 'dummy', FUUID: 'fuuid-1', ...internals }, Readings: {}, Attributes: {}, PossibleSets: 'on off', PossibleAttrs: '', ...rest,
});

describe('deviceIdentity', () => {
  it('uses the FUUID where fhem knows nothing better', () => {
    expect(deviceIdentity(device({}), {})).toEqual({
      name: 'dev-1', fuuid: 'fuuid-1', alias: 'dev_1', siriName: 'dev_1', device: 'dev_1', type: 'dummy',
      model: '<unknown>', PossibleSets: 'on off', room: undefined, serial: 'fuuid-1', uuid_base: 'fuuid-1',
    });
  });

  it('uses the hardware address for device types that have one', () => {
    expect(deviceIdentity(device({ TYPE: 'FS20', DEF: '1234 01' }), {}).uuid_base).toBe('FS20.1234 01');
    expect(deviceIdentity(device({ TYPE: 'CUL_HM', DEF: 'ABCDEF' }), {}).uuid_base).toBe('CUL_HM.ABCDEF');
  });

  it('lets the SerialNumber mapping decide', () => {
    expect(deviceIdentity(device({ TYPE: 'FS20', DEF: '1234 01' }), { SerialNumber: { serial: 'S1' } }).uuid_base).toBe('S1');
  });

  it('fails for a ZWave device without definition', () => {
    expect(() => deviceIdentity(device({ TYPE: 'ZWave' }), {})).toThrow(TypeError);
  });
});
