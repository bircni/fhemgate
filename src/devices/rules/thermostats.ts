// thermostats, recognised by the command the desired temperature is set with
import { CustomUUIDs } from '../../accessory/customCharacteristics.ts';
import { numberAsText, type Mapping } from '../../mapping/types.ts';
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

/**
 * A thermostat that says nothing about whether it is heating is shown as heating.
 * This also holds while its valve is closed. See docs/KNOWN_BUGS.md, 4.
 */
export const heatingStateDefault: Rule = ({ target }) => {
  if (target.service_name !== 'thermostat' || target.mappings.CurrentHeatingCoolingState) {
    return false;
  }

  target.mappings.CurrentHeatingCoolingState = { default: 'HEAT' };
  return true;
};
