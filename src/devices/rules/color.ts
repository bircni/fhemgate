// coloured lights. fhem modules report colour as hue and saturation, as rgb, or as xy
// coordinates, HomeKit only knows hue, saturation and brightness.
import { numberAsText, type Mapping } from '../../mapping/types.ts';
import type { PluginState } from '../../state/pluginState.ts';
import { hsv2rgb, rgb2hsv, type Hsv } from '../../util/color.ts';
import { toInt } from '../../util/loose.ts';
import type { Rule } from '../detect.ts';

/** `set hue`, with the largest value of the device taken from the widget of the command */
export const hue: Rule = ({ s, target }) => {
  const match = s.PossibleSets.match(/(^| )hue(:[^\b\s]*(,(\d+))+)?\b/);
  if (!match) {
    return false;
  }

  if (!target.service_name) {
    target.service_name = 'light';
  }
  const max = match[4] !== undefined ? numberAsText(match[4]) : 359;
  target.mappings.Hue = { reading: 'hue', cmd: 'hue', max: max, maxValue: 359 };
  return true;
};

/** `set sat`, like hue */
export const saturation: Rule = ({ s, target }) => {
  const match = s.PossibleSets.match(/(^| )sat(:[^\b\s]*(,(\d+))+)?\b/);
  if (!match) {
    return false;
  }

  if (!target.service_name) {
    target.service_name = 'light';
  }
  const max = match[4] !== undefined ? numberAsText(match[4]) : 100;
  target.mappings.Saturation = { reading: 'sat', cmd: 'sat', max: max, maxValue: 100 };
  return true;
};

export const milight: Rule = ({ s, target }) => {
  if (s.Internals.TYPE !== 'MilightDevice' || !s.PossibleSets.match(/(^| )dim\b/)) {
    return false;
  }

  if (!target.service_name) {
    target.service_name = 'light';
  }
  target.log.debug('detected MilightDevice');
  target.mappings.Brightness = { reading: 'brightness', cmd: 'dim', max: 100, maxValue: 100, delay: true };
  if (s.PossibleSets.match(/(^| )hue\b/) && s.PossibleSets.match(/(^| )saturation\b/)) {
    target.mappings.Hue = { reading: 'hue', cmd: 'hue', max: 359, maxValue: 359 };
    target.mappings.Saturation = { reading: 'saturation', cmd: 'saturation', max: 100, maxValue: 100 };
  }
  return true;
};

/** WifiLight takes hue, saturation and brightness together in one `set HSV` */
export const wifilight: Rule = ({ s, target, state }) => {
  if (s.Internals.TYPE !== 'WifiLight' || !s.PossibleSets.match(/(^| )HSV\b/)
      || s.Readings.hue === undefined || s.Readings.saturation === undefined || s.Readings.brightness === undefined) {
    return false;
  }

  if (!target.service_name) {
    target.service_name = 'light';
  }
  target.log.debug('detected WifiLight');
  const hueMapping: Mapping = { reading: 'hue', cmd: 'HSV', max: 359, maxValue: 359 };
  const saturationMapping: Mapping = { reading: 'saturation', cmd: 'HSV', max: 100, maxValue: 100 };
  const brightnessMapping: Mapping = { reading: 'brightness', cmd: 'HSV', max: 100, maxValue: 100, delay: true };
  target.mappings.Hue = hueMapping;
  target.mappings.Saturation = saturationMapping;
  target.mappings.Brightness = brightnessMapping;

  hueMapping.homekit2reading = wifilightHsv.bind(null, state, hueMapping);
  saturationMapping.homekit2reading = wifilightHsv.bind(null, state, saturationMapping);
  brightnessMapping.homekit2reading = wifilightHsv.bind(null, state, brightnessMapping);
  return true;
};

/** the three values for `set HSV`: the new one, and the other two as last seen */
function wifilightHsv(state: PluginState, mapping: Mapping, orig: unknown): string {
  const cached = state.cache.values;
  let h = cached[mapping.device + '-hue'];
  let s = cached[mapping.device + '-saturation'];
  let v = cached[mapping.device + '-brightness'];

  if (h === undefined) {
    h = 0;
  }
  if (s === undefined) {
    s = 100;
  }
  if (v === undefined) {
    v = 100;
  }

  if (mapping.characteristic_type === 'Hue') {
    h = orig;
    cached[mapping.device + '-hue'] = orig;
  } else if (mapping.characteristic_type === 'Saturation') {
    s = orig;
    cached[mapping.device + '-saturation'] = orig;
  } else if (mapping.characteristic_type === 'Brightness') {
    v = orig;
    cached[mapping.device + '-brightness'] = orig;
  }

  return String(h) + ',' + String(s) + ',' + String(v);
}

/**
 * `set rgb` or `set RGB` with a colour as six hex digits. Used for lights that have no hue
 * command. The three HomeKit characteristics all read and write the one rgb reading: what is
 * not being changed is kept in the cache as `<device>-h`, `-s` and `-v`, as fractions of 1.
 */
export const rgb: Rule = ({ s, target, state }) => {
  if (target.mappings.Hue && s.Internals.TYPE !== 'SWAP_0000002200000003') {
    return false;
  }

  let reading: string | undefined = undefined;
  let cmd: string | undefined = undefined;
  if (s.PossibleSets.match(/(^| )rgb\b/)) {
    if (!target.service_name) {
      target.service_name = 'light';
    }
    reading = 'rgb';
    cmd = 'rgb';
    if (s.Internals.TYPE === 'SWAP_0000002200000003') {
      reading = '0B-RGBlevel';
    }
  } else if (s.PossibleSets.match(/(^| )RGB\b/)) {
    if (!target.service_name) {
      target.service_name = 'light';
    }
    reading = 'RGB';
    cmd = 'RGB';
  }

  if (!reading || !cmd) {
    return false;
  }

  const hueMapping: Mapping = { reading: reading, cmd: cmd, max: 359, maxValue: 359 };
  const saturationMapping: Mapping = { reading: reading, cmd: cmd, max: 100, maxValue: 100 };
  const brightnessMapping: Mapping = { reading: reading, cmd: cmd, max: 100, maxValue: 100, delay: true };
  target.mappings.Hue = hueMapping;
  target.mappings.Saturation = saturationMapping;
  target.mappings.Brightness = brightnessMapping;

  hueMapping.reading2homekit = rgb2component.bind(null, state, hueMapping, 0, '-h');
  hueMapping.homekit2reading = hsvComponent2rgb.bind(null, state, hueMapping);
  saturationMapping.reading2homekit = rgb2component.bind(null, state, saturationMapping, 1, '-s');
  saturationMapping.homekit2reading = hsvComponent2rgb.bind(null, state, saturationMapping);
  brightnessMapping.reading2homekit = rgb2component.bind(null, state, brightnessMapping, 2, '-v');
  brightnessMapping.homekit2reading = hsvComponent2rgb.bind(null, state, brightnessMapping);
  return true;
};

/** hue, saturation or brightness of an rgb reading in the range of the characteristic. the fraction is kept in the cache. */
function rgb2component(state: PluginState, mapping: Mapping, index: 0 | 1 | 2, suffix: string, orig: string): number {
  const hsv = rgb2hsv(orig) as Hsv;
  const value = toInt((hsv[index] as number) * (mapping.maxValue as number));

  state.cache.values[mapping.device + suffix] = hsv[index];

  return value;
}

/** the rgb colour after one of hue, saturation and brightness changed, or undefined if it stays the same */
function hsvComponent2rgb(state: PluginState, mapping: Mapping, orig: number): string | undefined {
  const cached = state.cache.values;
  let h = cached[mapping.device + '-h'] as number | undefined;
  let s = cached[mapping.device + '-s'] as number | undefined;
  let v = cached[mapping.device + '-v'] as number | undefined;

  if (h === undefined) {
    h = 0.0;
  }
  if (s === undefined) {
    s = 1.0;
  }
  if (v === undefined) {
    v = 1.0;
  }

  if (mapping.characteristic_type === 'Hue') {
    h = orig / 360.0;
    cached[mapping.device + '-h'] = h;
  } else if (mapping.characteristic_type === 'Saturation') {
    s = orig / 100.0;
    cached[mapping.device + '-s'] = s;
  } else if (mapping.characteristic_type === 'Brightness') {
    v = orig / 100.0;
    cached[mapping.device + '-v'] = v;
  }

  const value = hsv2rgb(h, s, v);
  const informId = mapping.informId as string;
  if (value === cached[informId]) {
    return undefined;
  }

  state.update(informId, value, true);

  return value;
}

/** the colour mode and the xy colour of a light are kept, to follow colours that are set as xy or colour temperature */
export const colorMode: Rule = ({ s, target }) => {
  if (s.Readings.colormode) {
    target.mappings.colormode = { reading: 'colormode' };
  }
  if (s.Readings.xy) {
    target.mappings.xy = { reading: 'xy' };
  }
  return false;
};
