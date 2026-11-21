// works out from the readings, set commands and attributes of a fhem device which HomeKit
// service it is and how its characteristics map to readings and commands
import type { Logging } from 'homebridge';
import type { Mapping, Mappings } from '../mapping/types.ts';
import type { PluginState } from '../state/pluginState.ts';
import { doorState, garage, blind, hmSecWin, positionState, window } from './rules/blinds.ts';
import { colorMode, colorTemperature, hue, milight, rgb, saturation, wifilight } from './rules/color.ts';
import { fs20di, fs20Dimmer, homematicDimmer, hueBrightness, zwaveDimmer } from './rules/dimmers.ts';
import { hmccuMappings } from './rules/hmccu.ts';
import { hmSecKey, lock } from './rules/locks.ts';
import { harmony, sonos, volume } from './rules/media.ts';
import { current, energy, power, voltage } from './rules/power.ts';
import { presence, residents, roommateOrGuest } from './rules/presence.ts';
import {
  airQuality,
  battery,
  fhttk,
  firmware,
  humidity,
  lightLevel,
  maxShutterContact,
  pressure,
  reachable,
  temperature,
  threeStateSensor,
} from './rules/sensors.ts';
import { onOff, setList } from './rules/switches.ts';
import { desiredTemp, heatingStateDefault, maxDesiredTemperature, offerSupportedModes, pid20Desired, thermostatByType } from './rules/thermostats.ts';
import type { Jsonlist2Device } from './types.ts';

/** the part of an accessory the detection fills in */
export interface DetectionTarget {
  /**
   * What the device is: one of the genericDeviceType values (switch, light, blind, ...) or the
   * name of a HomeKit service. Starts as the genericDeviceType of the device, and the first rule
   * that recognises the device sets it if it is still open.
   */
  service_name?: string;
  mappings: Mappings;
  log: Logging;
}

export interface DetectionContext {
  s: Jsonlist2Device;
  /** the genericDeviceType attribute of the device, or its genericDisplayType */
  genericType: string | undefined;
  /** the device is a HMCCU device and the HMCCU rule has mapped it */
  isHMCCU: boolean;
  target: DetectionTarget;
  state: PluginState;
}

/** whether a device gets an accessory: `ignored` is a device left out on purpose, `undetected` one nothing was recognised of */
export type Detection = 'detected' | 'ignored' | 'undetected';

/**
 * Looks at one thing a device can have or be and adds the mappings for it. Answers whether it
 * applied, or `stop` if the device is not to be published at all.
 */
export type Rule = (context: DetectionContext) => boolean | 'stop';

/** tries the rules in order until one applies */
function firstOf(...rules: Rule[]): Rule {
  return (context) => {
    for (const rule of rules) {
      const applied = rule(context);
      if (applied) {
        return applied;
      }
    }
    return false;
  };
}

// the rules run in this order, and it matters: later rules look at the service and the mappings
// earlier ones have set, and the first rule to name a service wins.
const rules: Rule[] = [
  firstOf(zwaveDimmer, hueBrightness, homematicDimmer, fs20Dimmer),
  hue,
  saturation,
  firstOf(milight, wifilight),
  rgb,
  colorTemperature,
  colorMode,

  volume,
  voltage,
  current,
  power,
  energy,
  lightLevel,
  airQuality,
  positionState,
  doorState,
  battery,
  firmware,
  reachable,

  firstOf(
    garage,
    blind,
    hmSecWin,
    window,
    hmSecKey,
    lock,
    thermostatByType,
    fhttk,
    maxShutterContact,
    threeStateSensor,
    presence,
    roommateOrGuest,
    residents,
    fs20di,
  ),

  firstOf(desiredTemp, maxDesiredTemperature, pid20Desired),

  firstOf(sonos, harmony, onOff, setList),

  temperature,
  humidity,
  pressure,

  heatingStateDefault,
];

/**
 * Fills in the service and the mappings of the target for the device. Answers whether the device
 * gets an accessory, and if not whether it is left out on purpose or because nothing was
 * recognised. Nothing is logged for a device that is left out on purpose beyond a note.
 */
export function detectMappings(target: DetectionTarget, s: Jsonlist2Device, state: PluginState): Detection {
  let genericType = s.Attributes.genericDeviceType;
  if (genericType === undefined) {
    genericType = s.Attributes.genericDisplayType;
  }

  if (genericType === 'ignore') {
    target.log.info('ignoring ' + s.Internals.NAME);
    return 'ignored';
  }

  target.service_name = genericType;

  if ((s.Internals.TYPE === 'structure' || s.Internals.TYPE === 'SVG' || s.Internals.TYPE === 'THRESHOLD') && genericType === undefined) {
    target.log.info('ignoring ' + s.Internals.NAME + ' (' + s.Internals.TYPE + ') without genericDeviceType');
    return 'ignored';
  }

  target.mappings = {};

  // HMCCU devices use ccu datapoint names for their readings and none of the CUL_HM
  // attributes the rules below rely on, so they are mapped separately.
  let isHMCCU = false;
  if (s.Internals.TYPE === 'HMCCUCHN' || s.Internals.TYPE === 'HMCCUDEV') {
    isHMCCU = hmccuMappings(target, s, genericType);
  }

  const context: DetectionContext = { s, genericType, isHMCCU, target, state };
  for (const rule of rules) {
    if (rule(context) === 'stop') {
      return 'ignored';
    }
  }

  if (!target.service_name) {
    target.log.error(s.Internals.NAME + ': no service type detected');
    return 'undetected';
  }

  return 'detected';
}

/** what is settled only after the homebridgeMapping attribute was applied */
export function reviseMappings(target: DetectionTarget, s: Jsonlist2Device): void {
  if (
    target.mappings.CurrentPosition ||
    target.mappings.TargetTemperature ||
    target.service_name === 'lock' ||
    target.service_name === 'garage' ||
    target.service_name === 'window'
  ) {
    delete target.mappings.On;
  }

  if (target.service_name === 'thermostat') {
    // the cmd can carry arguments, e.g. 'datapoint 1.SET_POINT_TEMPERATURE'. only the
    // command itself is listed in PossibleSets.
    const targetTemperature = target.mappings.TargetTemperature as Mapping | undefined;
    const targetCmd = targetTemperature ? targetTemperature.cmd : undefined;
    const targetVerb = targetCmd ? targetCmd.split(' ')[0] : undefined;

    if (!targetVerb || !s.PossibleSets.match('(^| )' + targetVerb + '\\b')) {
      target.log.error(s.Internals.NAME + ' is NOT a thermostat. set command for target temperature missing: ' + (targetCmd ? targetCmd : ''));
      delete target.mappings.TargetTemperature;
    }
  }

  if (target.service_name === 'thermostat' || target.service_name === 'Thermostat') {
    offerSupportedModes(target);
  }
}
