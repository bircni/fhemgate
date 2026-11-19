// how an accessory gets its name, model and serial number. homekit recognises an accessory
// by the serial number, so these rules decide whether rooms and automations survive an update.
import { describe, expect, it } from 'vitest';
import { device, type DeviceOptions } from './support/devices.ts';
import { createWorld, hap, sanitizeHapName } from './support/subject.ts';

const FUUID = '5f0d1e7a-f33f-1a2b-3c4d-000000000001';

function accessoryFor(options: DeviceOptions) {
  return createWorld().accessory(device({ Readings: { state: 'on' }, PossibleSets: 'on off', ...options }));
}

describe('names', () => {
  it('replaces underscores, which homekit does not allow in names', () => {
    expect(sanitizeHapName('EG_Kueche_Licht')).toBe('EG-Kueche-Licht');
    expect(sanitizeHapName('Küche.Spüle 1')).toBe('Küche.Spüle 1');
  });

  it('has a name for a device without one', () => {
    expect(sanitizeHapName(undefined)).toBe('FHEM Device');
    expect(sanitizeHapName(null)).toBe('FHEM Device');
    expect(sanitizeHapName('')).toBe('FHEM Device');
    expect(sanitizeHapName(7)).toBe('7');
  });

  it('uses the alias and the siriName for what the user sees, and keeps the device name for fhem', () => {
    const plain = accessoryFor({ Internals: { NAME: 'EG_Licht' } });
    expect([plain.name, plain.device, plain.alias, plain.siriName]).toEqual(['EG-Licht', 'EG_Licht', 'EG_Licht', 'EG_Licht']);

    const alias = accessoryFor({ Internals: { NAME: 'EG_Licht' }, Attributes: { alias: 'Licht' } });
    expect([alias.name, alias.alias, alias.siriName]).toEqual(['EG-Licht', 'Licht', 'Licht']);

    const siri = accessoryFor({ Internals: { NAME: 'EG_Licht' }, Attributes: { alias: 'Licht', siriName: 'Deckenlicht' } });
    expect([siri.name, siri.alias, siri.siriName]).toEqual(['EG-Licht', 'Licht', 'Deckenlicht']);
  });

  it('names the services after the siriName, without replacing anything', () => {
    const services = accessoryFor({ Internals: { NAME: 'EG_Licht' }, Attributes: { siriName: 'Licht_1' } }).getServices();

    expect(services[1]?.displayName).toBe('Licht_1');
    expect(services[1]?.getCharacteristic(hap.Characteristic.Name).value).toBe('Licht_1');
  });
});

describe('model', () => {
  it('prefers the model reading, then the attribute, then the internal', () => {
    expect(accessoryFor({ Readings: { model: 'R' }, Attributes: { model: 'A' }, Internals: { model: 'I' } }).model).toBe('R');
    expect(accessoryFor({ Attributes: { model: 'A' }, Internals: { model: 'I' } }).model).toBe('A');
    expect(accessoryFor({ Internals: { model: 'I' } }).model).toBe('I');
    expect(accessoryFor({}).model).toBe('<unknown>');
  });

  it.each([
    ['MAX', { type: 'HeatingThermostat', addr: 'abc' }, 'HeatingThermostat'],
    ['DUOFERN', { SUBTYPE: 'RolloTron', DEF: '40ABCD' }, 'RolloTron'],
    ['HMCCUDEV', { ccutype: 'HmIP-BSM', DEF: 'CCU 1' }, 'HmIP-BSM'],
    ['HMCCUCHN', { ccutype: 'HmIP-PS', DEF: 'CCU 1:3' }, 'HmIP-PS'],
  ])('takes it from the device itself for %s', (TYPE, internals, model) => {
    expect(accessoryFor({ Internals: { TYPE, ...internals }, Attributes: { model: 'ignored' } }).model).toBe(model);
  });
});

describe('serial number', () => {
  it.each<[string, DeviceOptions, string | undefined]>([
    ['CUL_HM: type and address', { Internals: { TYPE: 'CUL_HM', DEF: '2A3B4C' } }, 'CUL_HM.2A3B4C'],
    [
      'CUL_HM: the serialNr attribute',
      { Internals: { TYPE: 'CUL_HM', DEF: '2A3B4C' }, Attributes: { serialNr: 'LEQ1' }, Readings: { 'D-serialNr': 'LEQ2' } },
      'LEQ1',
    ],
    ['CUL_HM: the D-serialNr reading', { Internals: { TYPE: 'CUL_HM', DEF: '2A3B4C' }, Readings: { 'D-serialNr': 'LEQ2' } }, 'LEQ2'],
    ['CUL_WS', { Internals: { TYPE: 'CUL_WS', DEF: '3' } }, 'CUL_WS.3'],
    ['Siro', { Internals: { TYPE: 'Siro', DEF: '1234567 8' } }, 'Siro.1234567 8'],
    ['FS20', { Internals: { TYPE: 'FS20', DEF: '1234 01' } }, 'FS20.1234 01'],
    ['IT', { Internals: { TYPE: 'IT', DEF: '0F0F FF F0' } }, 'IT.0F0F FF F0'],
    ['EnOcean', { Internals: { TYPE: 'EnOcean', DEF: '0180ABCD' } }, 'EnOcean.0180ABCD'],
    ['HUEDevice: the unique id', { Internals: { TYPE: 'HUEDevice', uniqueid: '00:17:88:01:02:03:04:05-0b' } }, '00:17:88:01:02:03:04:05-0b'],
    ['HUEDevice: not the placeholder id', { Internals: { TYPE: 'HUEDevice', uniqueid: 'ff:ff:ff:ff:ff:ff:ff:ff-0b' } }, FUUID],
    ['HUEDevice: without an id', { Internals: { TYPE: 'HUEDevice' } }, FUUID],
    ['SONOSPLAYER: the UDN', { Internals: { TYPE: 'SONOSPLAYER', UDN: 'RINCON_1' } }, 'RINCON_1'],
    ['SONOSPLAYER: without a UDN', { Internals: { TYPE: 'SONOSPLAYER' } }, FUUID],
    ['WOL: the mac address', { Internals: { TYPE: 'WOL', MAC: '00:11:22:33:44:55' } }, 'WOL.00:11:22:33:44:55'],
    ['MAX: the address', { Internals: { TYPE: 'MAX', addr: '0a1b2c' } }, 'MAX.0a1b2c'],
    ['DUOFERN', { Internals: { TYPE: 'DUOFERN', DEF: '40ABCD' } }, 'DUOFERN.40ABCD'],
    ['ZWave: only the first blank replaced', { Internals: { TYPE: 'ZWave', DEF: 'c1e2 5 x' } }, 'ZWave.c1e2-5 x'],
    ['HMCCUDEV', { Internals: { TYPE: 'HMCCUDEV', DEF: 'CCU 000ABC', ccutype: 'x' } }, 'CCU 000ABC'],
    ['HMCCUCHN', { Internals: { TYPE: 'HMCCUCHN', DEF: 'CCU 000ABC:4', ccutype: 'x' } }, 'CCU 000ABC:4'],
    ['everything else: the FUUID', { Internals: { TYPE: 'dummy', DEF: 'x' } }, FUUID],
    ['everything else without a FUUID: nothing', { Internals: { TYPE: 'dummy', FUUID: undefined as unknown as string } }, undefined],
  ])('%s', (_name, options, serial) => {
    const accessory = accessoryFor(options);

    expect(accessory.serial).toBe(serial);
    expect(accessory.uuid_base).toBe(serial);
  });

  it('can be set with a SerialNumber mapping', () => {
    expect(accessoryFor({ Attributes: { homebridgeMapping: 'SerialNumber=serial=ABC' } }).uuid_base).toBe('ABC');
    expect(accessoryFor({ Attributes: { homebridgeMapping: 'SerialNumber=value=XYZ' } }).uuid_base).toBe('XYZ');
    expect(accessoryFor({ Attributes: { homebridgeMapping: 'SerialNumber=serial=ABC,value=XYZ' } }).uuid_base).toBe('ABC');
    expect(accessoryFor({ Attributes: { homebridgeMapping: 'SerialNumber=other=1' } }).uuid_base).toBe(FUUID);
  });

  it('is shown to homekit as the FUUID of the device', () => {
    const accessory = accessoryFor({ Internals: { TYPE: 'FS20', DEF: '1234 01' } });
    accessory.getServices();

    expect(accessory.displayName).toBe(FUUID);
  });
});

describe('information service', () => {
  it('names fhem and the device type as manufacturer and model', () => {
    const information = accessoryFor({ Internals: { TYPE: 'FS20', DEF: '1234 01' }, Attributes: { model: 'fs20st' } }).getServices()[0];

    expect(information?.getCharacteristic(hap.Characteristic.Manufacturer).value).toBe('FHEM:FS20');
    expect(information?.getCharacteristic(hap.Characteristic.Model).value).toBe('FHEM:fs20st');
    expect(information?.getCharacteristic(hap.Characteristic.SerialNumber).value).toBe('FS20.1234 01');
  });

  it('says unknown for a device without serial number', () => {
    const information = accessoryFor({ Internals: { FUUID: undefined as unknown as string } }).getServices()[0];

    expect(information?.getCharacteristic(hap.Characteristic.SerialNumber).value).toBe('<unknown>');
  });
});
