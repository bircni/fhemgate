// thermostats, recognised by the command the desired temperature is set with
import { CustomUUIDs } from '../../accessory/customCharacteristics.ts';
import { numberAsText, type Mapping, type Mappings } from '../../mapping/types.ts';
import type { Rule } from '../detect.ts';

/** the opening of the valve in percent, shown with the characteristic Eve knows */
const actuation = (reading: string): Mapping => ({
  reading: reading,
  name: 'Actuation',
  format: 'UINT8',
  unit: 'PERCENTAGE',
  maxValue: 100,
  minValue: 0,
  minStep: 1,
});

/** genericDeviceType or subType thermostat. the mappings come from the rules below. */
export const thermostatByType: Rule = ({ s, target, genericType }) => {
  if (genericType !== 'thermostat' && s.Attributes.subType !== 'thermostat') {
    return false;
  }

  if (!target.service_name) {
    target.service_name = 'thermostat';
  }
  return true;
};

/** HomeMatic and Comet DECT: `set desired-temp` */
export const desiredTemp: Rule = ({ s, target, isHMCCU }) => {
  const match = isHMCCU ? null : s.PossibleSets.match(/(^| )desired-temp(:[^\d]*([^$ ]*))?/);
  if (!match) {
    return false;
  }

  if (!target.service_name) {
    target.service_name = 'thermostat';
  }
  const targetTemperature: Mapping = { reading: 'desired-temp', cmd: 'desired-temp', delay: true };
  target.mappings.TargetTemperature = targetTemperature;
  if (s.Readings['desired-temp'] === undefined) {
    //Comet DECT
    targetTemperature.reading = 'temperature';
  }

  if (s.Readings.actuator) {
    target.mappings[CustomUUIDs.Actuation] = actuation('actuator');
  } else if (s.Readings.ValvePosition) {
    target.mappings[CustomUUIDs.Actuation] = actuation('ValvePosition');
  }

  // the range comes from the widget of the set command: `slider,<min>,<step>,<max>` or a list of all values
  if (match[3]) {
    const values = match[3].split(',');
    if ((match[2] as string).match(/slider/)) {
      targetTemperature.minValue = parseFloat(values[0] as string);
      targetTemperature.maxValue = parseFloat(values[2] as string);
      targetTemperature.minStep = numberAsText(values[1]);
    } else {
      targetTemperature.minValue = parseFloat(values[0] as string);
      targetTemperature.maxValue = parseFloat(values[values.length - 1] as string);
      targetTemperature.minStep = numberAsText(values[1]) - numberAsText(values[0]);
    }
  }

  if (s.PossibleSets.match(/(^| )mode($| )/)) {
    target.mappings.TargetHeatingCoolingState = {
      reading: 'mode',
      values: ['/^auto/:AUTO', '/^holiday_short/:OFF', '/.*/:HEAT'],
      cmds: ['OFF:mode holiday_short', 'HEAT:mode manual', 'COOL:mode manual', 'AUTO:mode auto'],
      // these thermostats heat. cooling is not offered, and still understood if it is asked for.
      valid: ['OFF', 'HEAT', 'AUTO'],
    };
  }
  return true;
};

/** MAX: `set desiredTemperature` */
export const maxDesiredTemperature: Rule = ({ s, target, isHMCCU }) => {
  const match = isHMCCU ? null : s.PossibleSets.match(/(^| )desiredTemperature(:[^\d]*([^$ ]*))?/);
  if (!match) {
    return false;
  }

  if (!target.service_name) {
    target.service_name = 'thermostat';
  }
  const targetTemperature: Mapping = { reading: 'desiredTemperature', cmd: 'desiredTemperature', delay: true };
  target.mappings.TargetTemperature = targetTemperature;

  if (s.Readings.valveposition) {
    target.mappings[CustomUUIDs.Actuation] = actuation('valveposition');
  }

  // the list of values ends with `on`, the highest temperature is the one before
  if (match[3]) {
    const values = match[3].split(',');
    targetTemperature.minValue = parseFloat(values[0] as string);
    targetTemperature.maxValue = parseFloat(values[values.length - 2] as string);
    targetTemperature.minStep = numberAsText(values[1]) - numberAsText(values[0]);
  }
  return true;
};

/** PID20: `set desired` */
export const pid20Desired: Rule = ({ s, target, isHMCCU }) => {
  if (isHMCCU || !s.PossibleSets.match(/(^| )desired(:[^\d]*([^$ ]*))?/)) {
    return false;
  }

  if (!target.service_name) {
    target.service_name = 'thermostat';
  }
  target.mappings.TargetTemperature = { reading: 'desired', cmd: 'desired', delay: true };

  if (s.Readings.actuation) {
    target.mappings[CustomUUIDs.Actuation] = actuation('actuation');
  }

  if (s.Readings.measured) {
    target.mappings.CurrentTemperature = { reading: 'measured' };
  }
  return true;
};

/** a valve position of zero, as `0`, `0.0` or with a unit behind it */
const valveClosed = '/^0+(\\.0+)?( |%|$)/';

/**
 * A thermostat says nothing about whether it is heating, unless a rule before this one has
 * found what does. With a valve position it is heating while the valve is open. Without one
 * nothing is known, and it is shown as heating.
 */
export const heatingStateDefault: Rule = ({ target }) => {
  if (target.service_name !== 'thermostat' || target.mappings.CurrentHeatingCoolingState) {
    return false;
  }

  const valve = target.mappings[CustomUUIDs.Actuation] as Mapping | undefined;
  if (valve?.reading !== undefined) {
    target.mappings.CurrentHeatingCoolingState = { reading: valve.reading, values: [valveClosed + ':OFF', '/.*/:HEAT'], default: 'HEAT' };
  } else {
    target.mappings.CurrentHeatingCoolingState = { default: 'HEAT' };
  }
  return true;
};

/** the left or the right side of the `from:to` pairs of a mapping, or undefined if one of them does not name a single value */
function namedValues(pairs: string[], side: 'from' | 'to'): string[] | undefined {
  const values: string[] = [];
  for (const pair of pairs) {
    const separator = pair.indexOf(':');
    const from = separator < 0 ? pair : pair.slice(0, separator);
    const value = side === 'from' || separator < 0 ? from : pair.slice(separator + 1);
    // a pattern on the left of a command stands for any number of values, and `#` on the right for the reading itself
    if (value === '' || value === '#' || (side === 'from' && /^\/.*\/$/.test(value))) {
      return undefined;
    }
    values.push(value);
  }
  return values;
}

/**
 * HomeKit offers Off, Heat, Cool and Auto for every thermostat unless it is told which of them
 * there are. Run once the homebridgeMapping attribute was applied: a mapping that says with
 * `valid` what to offer is left alone. Otherwise the target state offers the modes the mapping
 * has a command for, or without commands the modes its `values` can report. A thermostat without
 * a mapping for the target state can not be switched to anything, and is shown as heating.
 */
export function offerSupportedModes(target: { mappings: Mappings }): void {
  const entry = target.mappings.TargetHeatingCoolingState;
  if (entry === undefined) {
    target.mappings.TargetHeatingCoolingState = { default: 'HEAT', valid: ['HEAT'], readOnly: true };
    return;
  }

  if (Array.isArray(entry) || entry.valid !== undefined) {
    return;
  }

  let modes: string[] | undefined;
  if (Array.isArray(entry.cmds) && entry.cmds.length) {
    modes = namedValues(entry.cmds, 'from');
  } else if (Array.isArray(entry.values) && entry.values.length) {
    modes = namedValues(entry.values, 'to');
    if (modes && entry.default !== undefined) {
      modes.push(String(entry.default));
    }
  }

  if (modes?.length) {
    entry.valid = [...new Set(modes)];
  }
}
