// builds the HomeKit services of an accessory from its mappings and connects their
// characteristics to fhem
import util from 'node:util';
import type { Characteristic, CharacteristicSetCallback, CharacteristicValue, Service } from '@homebridge/hap-nodejs';
import type { Mapping, PreparedMapping } from '../mapping/types.ts';
import type { PluginState } from '../state/pluginState.ts';
import { ct2rgb, rgb2hsv, xyY2rgb, type Hsv } from '../util/color.ts';
import type { FhemAccessory, NamedService, QueryCallback } from './accessory.ts';
import { CustomUUIDs } from './customCharacteristics.ts';
import { addEveCharacteristics, addHistoryService } from './history.ts';

const uuidFormat = /[0-9A-F]{8}-[0-9A-F]{4}-[0-9A-F]{4}-[0-9A-F]{4}-[0-9A-F]{12}/i;

/** a characteristic that is not one of HomeKit's own is created with only a name and a uuid. its properties are set afterwards. */
export type CustomCharacteristicClass = new (name: string, uuid: string) => Characteristic;

/** the value of a characteristic is set directly where HomeKit is not to be told */
const setQuietly = (characteristic: Characteristic, value: unknown): void => {
  characteristic.value = value as CharacteristicValue;
};

/** `; means <name>` for a value that stands for a named HomeKit value, for the log */
function meaning(mapping: Mapping, value: unknown): string {
  if (mapping.homekit2name === undefined) {
    return '';
  }
  return '; means ' + (mapping.homekit2name[value as string] ?? '???');
}

/**
 * The services of the accessory: the accessory information, one service for the device, more
 * for mappings that name another service or a subtype, and the history if the device has one.
 *
 * Nothing keeps two services of the same type from getting the same subtype, which homebridge
 * refuses for the whole platform. See docs/KNOWN_BUGS.md, 32.
 */
export function createServices(accessory: FhemAccessory, state: PluginState): Service[] {
  const { Service, Characteristic, Perms } = state.hap;
  // the formats and units of HomeKit by the names a mapping gives them
  const { Formats: formats, Units: units } = state.hap as unknown as Record<'Formats' | 'Units', Record<string, string | undefined>>;
  const cached = state.cache.values;
  const log = accessory.log;
  const single = (name: string) => accessory.mappings[name] as PreparedMapping | undefined;

  const services: Service[] = [];

  log('creating services for ' + accessory.name);

  log('  information service for ' + accessory.name);
  const informationService = new Service.AccessoryInformation();
  services.push(informationService);

  // a mapping for one of these three is handed to HomeKit as it is, which is no text. see docs/KNOWN_BUGS.md, 28.
  log('    manufacturer, model and serial number characteristics for ' + accessory.name);
  informationService
    .setCharacteristic(Characteristic.Manufacturer, (accessory.mappings.Manufacturer
      ? accessory.mappings.Manufacturer : ('FHEM:' + accessory.type)) as string)
    .setCharacteristic(Characteristic.Model, (accessory.mappings.Model
      ? accessory.mappings.Model : ('FHEM:' + (accessory.model ? accessory.model : '<unknown>'))) as string)
    .setCharacteristic(Characteristic.SerialNumber, (accessory.mappings.SerialNumber
      ? accessory.mappings.SerialNumber : (accessory.serial ? accessory.serial : '<unknown>')) as string);

  const firmwareRevision = single('FirmwareRevision');
  if (firmwareRevision) {
    log('    firmware revision characteristic for ' + accessory.name);

    // eslint-disable-next-line @typescript-eslint/no-unnecessary-condition -- as it was: add what is not there
    const characteristic = informationService.getCharacteristic(Characteristic.FirmwareRevision)
                           || informationService.addCharacteristic(Characteristic.FirmwareRevision);

    accessory.subscribe(firmwareRevision, characteristic);

    setQuietly(characteristic, cached[firmwareRevision.informId as string]);

    characteristic
      .on('get', (callback) => {
        const mapping = single('FirmwareRevision');
        if (mapping) {
          accessory.query(mapping, callback as QueryCallback);
        }
      });
  }

   
  const nameCharacteristic = informationService.getCharacteristic(Characteristic.Name);
  // eslint-disable-next-line @typescript-eslint/no-unnecessary-condition -- as it was
  if (nameCharacteristic) {
    log('    name (siriName) characteristic for ' + accessory.name);
    nameCharacteristic
      .on('set', (_value, callback) => {
        // a new name from HomeKit is accepted and not written back to fhem
        callback();
      })
      .on('get', (callback) => {
        callback(null, accessory.siriName);
      });
  }

  // HAP-NodeJS 2 has no Reachable characteristic any more. see docs/KNOWN_BUGS.md, 27.
  if ((Characteristic as unknown as { Reachable?: unknown }).Reachable) {
    const reachable = single('Reachable');
    if (reachable) {
      log.info('  ' + accessory.device + ' has reachability [' + reachable.reading + ']');
      accessory.subscribe(reachable);
    }
  }

  // a light that is in xy or colour temperature mode reports no hue and saturation. they are
  // worked out here once and then with every event for xy or ct.
  const colormode = single('colormode');
  const xy = single('xy');
  const ct = single('ct');
  if (colormode && (xy || ct)) {
    accessory.subscribe(xy);
    accessory.subscribe(colormode);

    let hsv: Hsv | undefined = undefined;
    let device: string | undefined = undefined;
    if (xy && cached[colormode.informId as string] === 'xy') {
      const value = (cached[xy.informId as string] as string).split(',');
      hsv = rgb2hsv(xyY2rgb(value[0] as string, value[1] as string, 1));
      device = xy.device;
    } else if (ct && cached[colormode.informId as string] === 'ct') {
      hsv = rgb2hsv(ct2rgb(cached[ct.informId as string] as string));
      device = ct.device;
    }

    if (hsv) {
      cached[device + '-h'] = hsv[0];
      cached[device + '-s'] = hsv[1];
      cached[device + '-v'] = hsv[2];
    }
  }

  accessory.displayName = accessory.fuuid;

  let controlService = accessory.createDeviceService(accessory.service_name);
  services.push(controlService);

  // the service, the mapping and the characteristic type of the last mapping that was looked at
  // stay for the mappings that follow and for the history characteristics after the loop:
  // a mapping without a service of its own lands on the service of the mapping before it.
  let service_name = controlService.service_name as string;
  let mapping: PreparedMapping | undefined = undefined;

  const seen: Record<string, boolean | undefined> = {};
  const services_hash: Record<string, NamedService | undefined> = {};
   
  for (let characteristic_type in accessory.mappings) {
    const entry = accessory.mappings[characteristic_type];
    const mappings = (Array.isArray(entry) ? entry : [entry]) as PreparedMapping[];

    if (characteristic_type === 'Reachable') {
      continue;
    }

    if (service_name === 'ContactSensor' && characteristic_type === 'CurrentDoorState'
        && accessory.mappings.history && accessory.mappings.ContactSensorState) {
      log.error(accessory.name + ': skipping CurrentDoorState characteristic as ContactSensor is also given and history is enabled');
      continue;
    }

    for (const each of mappings) {
      mapping = each;
      if (each._isInformation) {
        continue;
      }

      if (Object.keys(services_hash).length === 0) {
        controlService.subtype = each.subtype;
        services_hash[service_name + '#' + each.subtype] = controlService;
      }

      if (characteristic_type === 'history') {
        addHistoryService(accessory, state, services, each, service_name);
        continue;
      }

      const parts = characteristic_type.split('#');
      if (parts[1]) {
        service_name = parts[0] as string;
        characteristic_type = parts[1];

        //handle <service>(<subtype>)#<characteristic>
        const match = service_name.match(/(.+)\((.+)\)$/);
        if (match?.[2] !== undefined) {
          service_name = match[1] as string;
          each.subtype = match[2];
          if (!each.name) {
            each.name = service_name + '(' + each.subtype + ')#' + characteristic_type;
          }
        }
      } else if (each.subtype) {
        if (!each.name) {
          each.name = characteristic_type + '(' + each.subtype + ')';
        }
      }

      if (seen[service_name + '#' + characteristic_type]) {
        if (each.subtype === undefined) {
          log.error(accessory.name + ': ' + characteristic_type + ' characteristic already defined for service ' + accessory.name + ' and no subtype given');
          continue;
        }
      }

      const known = services_hash[service_name + '#' + each.subtype];
      if (known) {
        controlService = known;
      } else {
        controlService = accessory.createDeviceService(service_name, each.subtype);
        services.push(controlService);
        services_hash[service_name + '#' + each.subtype] = controlService;
      }

      if (each.subtype !== undefined) {
        controlService.subtype = each.subtype;
        if (service_name !== 'InputSource') {
          controlService.getCharacteristic(Characteristic.Name).setValue(each.subtype);
        }
      }

      if (characteristic_type === 'linkedTo') {
        const service = services_hash[each.reading + '#undefined'];
        if (!service) {
          log.error(accessory.name + ': no ' + each.reading + ' service to link to');
        } else if (each.reading === service_name) {
          log.error(accessory.name + ': can\'t link ' + each.reading + ' service to itself');
        } else {
          service.addLinkedService(controlService);
          log('    linked to ' + service.service_name);
        }

        continue;
      }

      if (!each.characteristic && each.name === undefined) {
        continue;
      }

      let characteristic: Characteristic;
      if (!each.characteristic) {
        if (!each.name) {
          each.name = characteristic_type;
        }
        const known = (CustomUUIDs as Record<string, string | undefined>)[characteristic_type];
        if (known) {
          characteristic_type = known;
        }
        if (!characteristic_type.match(uuidFormat)) {
          log.error(accessory.name + ': ' + (each.name ? each.name : each.characteristic_type) + ' invalid uuid format: ' + characteristic_type);
          continue;
        }
        characteristic = new (Characteristic as unknown as CustomCharacteristicClass)(each.name, characteristic_type);
        controlService.addCharacteristic(characteristic);
        each.name = 'Custom ' + each.name;
      } else {
        const characteristicClass = each.characteristic as Parameters<Service['getCharacteristic']>[0];
         
        characteristic = controlService.getCharacteristic(characteristicClass)
                         || controlService.addCharacteristic(characteristicClass as Parameters<Service['addCharacteristic']>[0]);
      }

      seen[service_name + '#' + characteristic_type] = true;

      log('    ' + (each.name ? each.name : each.characteristic_type)
                      + ' characteristic for ' + each.device + ':' + each.reading);

      accessory.subscribe(each, characteristic);

      if (each.cached !== undefined) {
        setQuietly(characteristic, each.cached);
        // eslint-disable-next-line @typescript-eslint/no-base-to-string -- logged as it comes
        log.debug('      initial value is: ' + String(characteristic.value)
                                                  + ' (' + typeof (characteristic.value) + meaning(each, each.cached) + ')');
      } else if (each.default !== undefined) {
        setQuietly(characteristic, each.default);
        // eslint-disable-next-line @typescript-eslint/no-base-to-string -- logged as it comes
        log.debug('      no initial value; default is: ' + String(characteristic.value) + ' (' + typeof (characteristic.value) + ')');
      } else {
        log.debug('      no default');
      }

      if (each.format !== undefined) {
        characteristic.setProps({ format: formats[each.format] });
      }
      if (each.unit !== undefined) {
        const unit = units[each.unit];
        characteristic.setProps({ unit: unit ? unit : each.unit });
      }
      if (each.minValue !== undefined) {
        characteristic.setProps({ minValue: each.minValue });
      }
      if (each.maxValue !== undefined) {
        characteristic.setProps({ maxValue: each.maxValue });
      }
      if (each.minStep !== undefined) {
        characteristic.setProps({ minStep: each.minStep });
      }
      if (each.valid !== undefined) {
        characteristic.setProps({ validValues: each.valid as number[] });
      }

      // eslint-disable-next-line @typescript-eslint/no-unnecessary-condition -- a characteristic created from a uuid has no properties yet
      if (characteristic_type.match(uuidFormat) || !characteristic.props?.perms?.length) {
        if (each.cmd === undefined) {
          characteristic.setProps({ perms: [Perms.PAIRED_READ, Perms.NOTIFY] });
        } else {
          characteristic.setProps({ perms: [Perms.PAIRED_READ, Perms.PAIRED_WRITE, Perms.NOTIFY] });
        }
      }

      log.debug('      props: ' + util.inspect(characteristic.props));

      characteristic
        .on('set', (value: CharacteristicValue, callback: CharacteristicSetCallback, context: unknown) => {
          // a value the plugin itself took over from fhem is not sent back
          if (context !== 'fromFHEM') {
            if (each.delay) {
              accessory.delayed(each, value, each.delay);
            } else {
              accessory.command(each, value);
            }

            if (each.timeout && each.default !== undefined) {
              setTimeout(() => {
                (each.characteristic as unknown as FromFhem).setValue(each.default, undefined, 'fromFHEM');
              }, each.timeout);
            }
          }
          callback();
        })
        .on('get', (callback) => {
          const reachable = single('Reachable');
          if (reachable?.cached === false) {
            (callback as QueryCallback)('unreachable');
          } else {
            accessory.query(each, callback as QueryCallback);
          }
        });
    }
  }

  if (accessory.historyService != null) {
    addEveCharacteristics(accessory, state, controlService, mapping as PreparedMapping, service_name, seen);
  }

  return services;
}

/** setValue as it is called here, with the callback left out */
interface FromFhem {
  setValue(value: unknown, callback: undefined, context: string): void;
}
