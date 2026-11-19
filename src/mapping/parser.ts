// reads the homebridgeMapping attribute of a device into the mappings of its accessory
import type { Logging } from 'homebridge';
import type { Mapping, Mappings } from './types.ts';

/** the part of an accessory the attribute is read into */
export interface MappingTarget {
  mappings: Mappings;
  log: Logging;
  category?: number;
}

/**
 * Changes the mappings of the target as the attribute says.
 *
 * The attribute is either a JSON object, which replaces all mappings, or a list of entries
 * separated by blanks or line breaks:
 *
 *     [<service>[(<subtype>)]#]<characteristic>=<parameter>,<parameter>,...
 *
 * where a parameter is `<name>=<value>`, `invert`, the name of another characteristic whose
 * mapping is copied, `clear`, or `[<cmd>:][<device>:]<reading>`.
 *
 * @param categories the accessory categories of HomeKit by name, for the AccessoryCategory entry
 */
export function parseHomebridgeMapping(target: MappingTarget, homebridgeMapping: string | undefined, categories?: Record<string, number | undefined>): void {
  if (!homebridgeMapping) {
    return;
  }

  target.log.info('homebridgeMapping: ' + homebridgeMapping);

  if (/^{.*}$/.test(homebridgeMapping)) {
    try {
      target.mappings = JSON.parse(homebridgeMapping) as Mappings;
    } catch (err) {
      target.log.error('  fromHomebridgeMapping JSON.parse: ' + String(err));
    }
    return;
  }

  const seen: Record<string, boolean> = {};
  let service: string | undefined = undefined;
  for (const entry of homebridgeMapping.split(/ |\n/)) {
    if (!entry) {
      continue;
    }
    if (entry.startsWith('#')) {
      continue;
    }

    if (entry === 'clear') {
      target.mappings = {};
      continue;
    }

    const match = /(^.*?)(:|=)(.*)/.exec(entry);
    if (!match?.[3]) {
      target.log.error('  wrong syntax: ' + entry);
      continue;
    }

    let characteristic = match[1] as string;
    const params = match[3];

    const parts = characteristic.split('#');
    if (parts[1]) {
      service = parts[0];
    } else if (service !== undefined) {
      characteristic = service + '#' + characteristic;
    }

    let mapping: Mapping;
    const existing = target.mappings[characteristic];
    if (!seen[characteristic] && existing !== undefined) {
      // a list of mappings is changed as if it was a single one
      mapping = existing as Mapping;
    } else {
      mapping = {};
      if (existing) {
        // anything without a length is a single mapping and becomes the first of a list
        const list = (existing as { length?: unknown }).length == null ? [existing as Mapping] : (existing as Mapping[]);
        target.mappings[characteristic] = list;
        list.push(mapping);
      } else {
        target.mappings[characteristic] = mapping;
      }
    }
    seen[characteristic] = true;

    for (const param of params.split(',')) {
      if (param === 'clear') {
        mapping = {};
        delete target.mappings[characteristic];
        continue;
      } else if (characteristic === 'AccessoryCategory') {
        delete target.mappings[characteristic];
        if (categories?.[param] === undefined) {
          target.log.error('unknown category: ' + param);
        } else {
          target.category = categories[param];
          target.log.info('using category: ' + String(target.category) + ' (' + param + ')');
        }
        continue;
      } else if (!target.mappings[characteristic]) {
        target.mappings[characteristic] = mapping;
      }

      const p = param.split('=') as [string, ...string[]];
      if (p.length === 2) {
        const [name, value] = p as [string, string];
        if (name === 'values' || name === 'valid' || name === 'cmds') {
          mapping[name] = value.split(';');
        } else if (name === 'delay') {
          const delay = parseInt(value);
          mapping.delay = isNaN(delay) ? true : delay;
        } else if (name === 'minValue' || name === 'maxValue' || name === 'minStep' || name === 'min' || name === 'max' || name === 'default') {
          const number = parseFloat(value);
          // text that is no number is kept as it is
          (mapping as Record<string, unknown>)[name] = isNaN(number) ? value : number;
        } else {
          mapping[name] = value.replace(/\+/g, ' ');
        }
      } else if (p.length === 1) {
        if (param === 'invert') {
          // the one parameter that needs no value
          mapping.invert = true;
          continue;
        }

        let other = target.mappings[param];
        if (other === undefined) {
          other = target.mappings[String(service) + '#' + param];
        }
        if (other !== undefined) {
          mapping = Object.assign({}, other) as Mapping;
          target.mappings[characteristic] = mapping;
        } else {
          const q = param.split(':');

          const reading = q[q.length - 1];
          const device = q.length > 1 ? q[q.length - 2] : undefined;
          const cmd = q.length > 2 ? q[q.length - 3] : undefined;

          if (reading) {
            mapping.reading = reading;
          }

          if (device) {
            mapping.device = device;
          }

          if (cmd) {
            mapping.cmd = cmd;
          }
        }
      } else {
        target.log.error('  wrong syntax: ' + param);
      }
    }
  }
}
