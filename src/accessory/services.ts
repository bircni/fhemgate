// builds the HomeKit services of an accessory from its mappings and connects their
// characteristics to fhem
import util from 'node:util';
import type { Characteristic, CharacteristicSetCallback, CharacteristicValue, Service } from '@homebridge/hap-nodejs';
import { reading2homekit } from '../mapping/toHomekit.ts';
import type { CharacteristicClass, HomekitValue, Mapping, PreparedMapping } from '../mapping/types.ts';
import type { PluginState } from '../state/pluginState.ts';
import { ct2rgb, rgb2hsv, xyY2rgb, type Hsv } from '../util/color.ts';
import type { FhemAccessory, NamedService, QueryCallback } from './accessory.ts';
import { acceptableValue } from './acceptable.ts';
import { CustomUUIDs } from './customCharacteristics.ts';
import { addEveCharacteristics, addHistoryService } from './history.ts';

const uuidFormat = /[0-9A-F]{8}-[0-9A-F]{4}-[0-9A-F]{4}-[0-9A-F]{4}-[0-9A-F]{12}/i;

/** a characteristic that is not one of HomeKit's own is created with only a name and a uuid. its properties are set afterwards. */
export type CustomCharacteristicClass = new (name: string, uuid: string) => Characteristic;

/** the value of a characteristic is set directly where HomeKit is not to be told */
const setQuietly = (characteristic: Characteristic, value: unknown): void => {
  characteristic.value = value as CharacteristicValue;
};

const numericFormats = new Set(['int', 'float', 'uint8', 'uint16', 'uint32', 'uint64']);

/** `; means <name>` for a value that stands for a named HomeKit value, for the log */
function meaning(mapping: Mapping, value: unknown): string {
  if (mapping.homekit2name === undefined) {
    return '';
  }
  return '; means ' + (mapping.homekit2name[value as string] ?? '???');
}

/** the characteristics of the accessory information a mapping can fill */
const informationCharacteristics = new Set(['Manufacturer', 'Model', 'SerialNumber', 'FirmwareRevision']);

/**
 * The text a mapping for the accessory information stands for: what the mapping itself says with
 * `value`, `serial` or `default`, or else the reading it names. Nothing without any of them.
 */
function informationText(entry: Mapping | Mapping[] | undefined): string | undefined {
  const mapping = Array.isArray(entry) ? entry[0] : entry;
  const text = mapping?.value ?? mapping?.serial ?? mapping?.default ?? mapping?.cached;
  return text === undefined || text === '' ? undefined : String(text);
}

/**
 * The services of the accessory: the accessory information, one service for the device, more
 * for mappings that name another service or a subtype, and the history if the device has one.
 *
 * HomeKit tells services of the same type apart by their subtype. A mapping that would need a
 * second service of a type without a subtype of its own is skipped: homebridge refuses such an
 * accessory, and with it every other accessory of the platform.
 */
export function createServices(accessory: FhemAccessory, state: PluginState): Service[] {
  const { Service, Characteristic, Perms } = state.hap;
  // the formats and units of HomeKit by the names a mapping gives them
  const { Formats: formats, Units: units } = state.hap as unknown as Record<'Formats' | 'Units', Record<string, string | undefined>>;
  const cached = state.cache.values;
  const log = accessory.log;
  const single = (name: string) => accessory.mappings[name] as PreparedMapping | undefined;

  const services: Service[] = [];

  log.debug('creating services for ' + accessory.name);

  log.debug('  information service for ' + accessory.name);
  const informationService = new Service.AccessoryInformation();
  services.push(informationService);

  log.debug('    manufacturer, model and serial number characteristics for ' + accessory.name);
  informationService
    .setCharacteristic(Characteristic.Manufacturer, informationText(accessory.mappings.Manufacturer) ?? 'FHEM:' + accessory.type)
    .setCharacteristic(Characteristic.Model, informationText(accessory.mappings.Model) ?? 'FHEM:' + (accessory.model ? accessory.model : '<unknown>'))
    .setCharacteristic(Characteristic.SerialNumber, informationText(accessory.mappings.SerialNumber) ?? (accessory.serial ? accessory.serial : '<unknown>'));

  const firmwareRevision = single('FirmwareRevision');
  if (firmwareRevision && firmwareRevision.cached === undefined) {
    // the characteristic keeps the 0.0.0 it starts with
    // eslint-disable-next-line @typescript-eslint/no-base-to-string -- readings are text
    const reading = String(cached[firmwareRevision.informId as string] ?? '');
    log.warn(accessory.name + ': the firmware reading "' + reading + '" holds no version number. HomeKit is not told a firmware revision.');
  } else if (firmwareRevision) {
    log.debug('    firmware revision characteristic for ' + accessory.name);

    // getCharacteristic only adds what the service knows as optional. the types say it always answers.
    /* eslint-disable @typescript-eslint/no-unnecessary-condition */
    const characteristic =
      informationService.getCharacteristic(Characteristic.FirmwareRevision) || informationService.addCharacteristic(Characteristic.FirmwareRevision);
    /* eslint-enable @typescript-eslint/no-unnecessary-condition */

    accessory.subscribe(firmwareRevision, characteristic);

    // the version that was taken out of the reading when the mappings were prepared
    setQuietly(characteristic, firmwareRevision.cached);

    characteristic.on('get', (callback) => {
      accessory.query(firmwareRevision, callback as QueryCallback);
    });
  }

  const nameCharacteristic = informationService.getCharacteristic(Characteristic.Name);
  // eslint-disable-next-line @typescript-eslint/no-unnecessary-condition -- as it was
  if (nameCharacteristic) {
    log.debug('    name (siriName) characteristic for ' + accessory.name);
    nameCharacteristic
      .on('set', (_value, callback) => {
        // a new name from HomeKit is accepted and not written back to fhem
        callback();
      })
      .on('get', (callback) => {
        callback(null, accessory.siriName);
      });
  }

  // HomeKit has no characteristic for whether a device can be reached. the mapping is followed
  // all the same: while it says no, reads of the other characteristics are answered with an error.
  const reachable = single('Reachable');
  if (reachable) {
    log.debug('  ' + accessory.device + ' has reachability [' + reachable.reading + ']');
    accessory.subscribe(reachable);
    reading2homekit(reachable, cached[reachable.informId as string]);
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

  // the service and the characteristic type of the last mapping that was looked at stay for the
  // mappings that follow: a mapping without a service of its own lands on the service of the
  // mapping before it.
  let service_name = controlService.service_name as string;

  const seen: Record<string, boolean | undefined> = {};
  const services_hash: Record<string, NamedService | undefined> = {};

  for (let characteristic_type in accessory.mappings) {
    const entry = accessory.mappings[characteristic_type];
    const mappings = (Array.isArray(entry) ? entry : [entry]) as PreparedMapping[];

    if (characteristic_type === 'Reachable') {
      continue;
    }

    // these are shown at the accessory information, which has them already. a mapping that
    // names a service for one of them, as `<service>#Model`, is none of these.
    if (informationCharacteristics.has(characteristic_type)) {
      continue;
    }

    if (service_name === 'ContactSensor' && characteristic_type === 'CurrentDoorState' && accessory.mappings.history && accessory.mappings.ContactSensorState) {
      log.error(accessory.name + ': skipping CurrentDoorState characteristic as ContactSensor is also given and history is enabled');
      continue;
    }

    for (const each of mappings) {
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
        const created = accessory.createDeviceService(service_name, each.subtype);
        if (services.some((existing) => existing.UUID === created.UUID && (!created.subtype || existing.subtype === created.subtype))) {
          log.error(
            accessory.name +
              ': ' +
              (each.characteristic_type ?? characteristic_type) +
              ' needs another ' +
              service_name +
              ' service ' +
              (created.subtype ? 'with the subtype ' + created.subtype + ', which another one has' : 'without a subtype') +
              '. give it a subtype of its own. the mapping is skipped.',
          );
          continue;
        }

        controlService = created;
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
          log.error(accessory.name + ": can't link " + each.reading + ' service to itself');
        } else {
          service.addLinkedService(controlService);
          log.debug('    linked to ' + service.service_name);
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
        const customUuid = (CustomUUIDs as Record<string, string | undefined>)[characteristic_type];
        if (customUuid) {
          characteristic_type = customUuid;
        }
        if (!characteristic_type.match(uuidFormat)) {
          log.error(accessory.name + ': ' + (each.name ? each.name : each.characteristic_type) + ' invalid uuid format: ' + characteristic_type);
          continue;
        }
        characteristic = new (Characteristic as unknown as CustomCharacteristicClass)(each.name, characteristic_type);
        controlService.addCharacteristic(characteristic);
        each.name = 'Custom ' + each.name;
      } else {
        // getCharacteristic only adds what the service knows as optional, and answers nothing for
        // a characteristic that does not belong to the service. the types say it always answers.
        const characteristicClass = each.characteristic as CharacteristicClass;
        /* eslint-disable @typescript-eslint/no-unnecessary-condition */
        characteristic = controlService.getCharacteristic(characteristicClass) || controlService.addCharacteristic(characteristicClass);
        /* eslint-enable @typescript-eslint/no-unnecessary-condition */
      }

      seen[service_name + '#' + characteristic_type] = true;

      log.debug('    ' + (each.name ? each.name : each.characteristic_type) + ' characteristic for ' + each.device + ':' + each.reading);

      accessory.subscribe(each, characteristic);

      if (each.cached !== undefined) {
        setQuietly(characteristic, each.cached);
        // eslint-disable-next-line @typescript-eslint/no-base-to-string -- logged as it comes
        log.debug('      initial value is: ' + String(characteristic.value) + ' (' + typeof characteristic.value + meaning(each, each.cached) + ')');
      } else if (each.default !== undefined) {
        setQuietly(characteristic, each.default);
        // eslint-disable-next-line @typescript-eslint/no-base-to-string -- logged as it comes
        log.debug('      no initial value; default is: ' + String(characteristic.value) + ' (' + typeof characteristic.value + ')');
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
      // only a number has a range, steps and a list of valid values. the conversion gives an
      // inverted on/off value the limits 0 and 1, which are no properties of a boolean.
      if (numericFormats.has(characteristic.props.format)) {
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
      }

      // the value the characteristic starts with has to fit what was just said about it
      const initial = acceptableValue(characteristic, characteristic.value);
      if (initial !== undefined && initial !== characteristic.value) {
        // eslint-disable-next-line @typescript-eslint/no-base-to-string -- logged as it comes
        log.debug('      initial value ' + String(characteristic.value) + ' is not accepted by HomeKit, using ' + String(initial));
        setQuietly(characteristic, initial);
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
        // only HomeKit writes through this handler: values from fhem are published with updateValue
        .on('set', (value: CharacteristicValue, callback: CharacteristicSetCallback) => {
          if (each.delay) {
            accessory.delayed(each, value, each.delay);
          } else {
            accessory.command(each, value);
          }

          const fallback = each.default;
          if (each.timeout && fallback !== undefined) {
            // a push button: HomeKit is shown the default again, and fhem is not told
            setTimeout(() => {
              characteristic.updateValue(fallback);
            }, each.timeout);
          }
          callback();
        })
        .on('get', (callback) => {
          if (single('Reachable')?.cached === false) {
            (callback as QueryCallback)('unreachable');
          } else {
            accessory.query(each, (error, value) => {
              if (error !== undefined) {
                (callback as QueryCallback)(error);
              } else {
                // a value HomeKit would reject is answered with the one the characteristic has
                (callback as QueryCallback)(undefined, acceptableValue(characteristic, value) ?? (characteristic.value as HomekitValue));
              }
            });
          }
        });
    }
  }

  if (accessory.historyService != null) {
    addEveCharacteristics(accessory, state, services, controlService, seen);
  }

  return services;
}
