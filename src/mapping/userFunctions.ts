// the reading2homekit and homekit2reading parameters of a mapping can name a function from the
// jsFunctions file of the platform, or carry the body of a function between braces
import util from 'node:util';
import type { Logging } from 'homebridge';
import type { Converter, Mapping } from './types.ts';

type UserFunction = (mapping: Mapping, value: unknown) => unknown;

/**
 * Replaces the text of a converter parameter of the mapping with the function it stands for.
 * The function gets the mapping and the value to convert.
 */
export function resolveConverter(mapping: Mapping, parameter: 'reading2homekit' | 'homekit2reading', jsFunctions: unknown, log: Logging): void {
  const given = mapping[parameter];
  if (given === undefined || typeof given === 'function') {
    return;
  }

  if (given.match(/^{.*}$/)) {
    try {
      // the attributes of fhem devices are trusted to carry code.
      // eslint-disable-next-line @typescript-eslint/no-implied-eval
      mapping[parameter] = new Function('mapping', 'orig', given).bind(null, mapping) as Converter;
    } catch (err) {
      log.error('  ' + parameter + ': ' + String(err));
    }
  } else if (typeof jsFunctions === 'object') {
    const named = (jsFunctions as Record<string, unknown>)[given];
    if (typeof named === 'function') {
      mapping[parameter] = (named as UserFunction).bind(null, mapping);
    } else {
      log.error('  ' + parameter + ': no function named ' + given + ' in ' + util.inspect(jsFunctions));
    }
  }

  if (mapping[parameter] !== undefined && typeof mapping[parameter] !== 'function') {
    log.error('  ' + parameter + ' disabled.');
    // for homekit2reading the text stays and reading2homekit goes as well.
    delete mapping.reading2homekit;
  }
}
