// lights that can be dimmed, recognised by the set command they dim with
import type { Mapping } from '../../mapping/types.ts';
import type { Rule } from '../detect.ts';

/** ZWave: `set dim <0-99>`, the state reads `dim <value>` */
export const zwaveDimmer: Rule = ({ s, target }) => {
  if (!s.PossibleSets.match(/(^| )dim:slider,0,1,99/)) {
    return false;
  }

  if (!target.service_name) {
    target.service_name = 'light';
  }
  target.mappings.On = { reading: 'state', valueOff: '/^(dim )?0$/', cmdOn: 'on', cmdOff: 'off' };
  const brightness: Mapping = { reading: 'state', cmd: 'dim', delay: true };
  target.mappings.Brightness = brightness;

  brightness.reading2homekit = zwaveBrightness.bind(null, brightness);
  return true;
};

function zwaveBrightness(_mapping: Mapping, orig: string): number {
  const match = orig.match(/dim (\d+)/);
  if (match) {
    return parseInt(match[1] as string);
  }

  return 0;
}

/** HUEDevice: `set bri <0-254>` exists, brightness is set with `set pct` */
export const hueBrightness: Rule = ({ s, target }) => {
  if (!s.PossibleSets.match(/(^| )bri(:[^\b\s]*(,(\d+))+)?\b/)) {
    return false;
  }

  if (!target.service_name) {
    target.service_name = 'light';
  }
  target.log.debug('detected HUEDevice');
  target.mappings.On = { reading: 'onoff', valueOff: '0', cmdOn: 'on', cmdOff: 'off' };
  //FIXME: max & maxValue are not set. they would work in both directions. but we use pct for the set cmd. not bri!
  const brightness: Mapping = { reading: 'bri', cmd: 'pct', delay: true };
  target.mappings.Brightness = brightness;

  brightness.reading2homekit = hueBri2percent.bind(null, brightness);
  return true;
};

function hueBri2percent(_mapping: Mapping, orig: string): number {
  return Math.round(Number(orig) / 2.54);
}

/** HomeMatic: `set pct <0-100>` */
export const homematicDimmer: Rule = ({ s, target }) => {
  if (!s.PossibleSets.match(/(^| )pct\b/)) {
    return false;
  }

  if (!target.service_name) {
    target.service_name = 'light';
  }
  target.mappings.On = { reading: 'pct', valueOff: '0', cmdOn: 'on', cmdOff: 'off' };
  target.mappings.Brightness = { reading: 'pct', cmd: 'pct', delay: true };
  return true;
};

/** FS20: sixteen steps, `set dim06%` to `set dim100%` */
export const fs20Dimmer: Rule = ({ s, target }) => {
  if (!s.PossibleSets.match(/(^| )dim\d+%/)) {
    return false;
  }

  if (!target.service_name) {
    target.service_name = 'light';
  }
  target.mappings.On = { reading: 'state', valueOff: 'off', cmdOn: 'on', cmdOff: 'off' };
  const brightness: Mapping = { reading: 'state', cmd: ' ', delay: true };
  target.mappings.Brightness = brightness;

  brightness.reading2homekit = fs20State2percent.bind(null, brightness);
  brightness.homekit2reading = percent2fs20Step.bind(null, brightness);
  return true;
};

function fs20State2percent(_mapping: Mapping, orig: string): number {
  if (orig.toLowerCase() === 'off') {
    return 0;
  }
  const match = orig.match(/dim(\d+)%?/);
  if (match) {
    return parseInt(match[1] as string);
  }

  return 100;
}

const fs20Steps = [
  'dim06%',
  'dim12%',
  'dim18%',
  'dim25%',
  'dim31%',
  'dim37%',
  'dim43%',
  'dim50%',
  'dim56%',
  'dim62%',
  'dim68%',
  'dim75%',
  'dim81%',
  'dim87%',
  'dim93%',
  'dim100%',
];

function percent2fs20Step(_mapping: Mapping, orig: number): string | undefined {
  if (orig > 97) {
    return 'dim100%';
  }

  return fs20Steps[Math.round(orig / 6.25)];
}

/** the FS20 dimmer model that is only switched */
export const fs20di: Rule = ({ s, target }) => {
  if (s.Attributes.model !== 'fs20di') {
    return false;
  }

  if (!target.service_name) {
    target.service_name = 'light';
  }
  return true;
};
