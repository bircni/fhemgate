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
export const desiredTemp: Rule = ({ s, target }) => {
  const match = s.PossibleSets.match(/(^| )desired-temp(:[^\d]*([^$ ]*))?/);
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
export const maxDesiredTemperature: Rule = ({ s, target }) => {
  const match = s.PossibleSets.match(/(^| )desiredTemperature(:[^\d]*([^$ ]*))?/);
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
export const pid20Desired: Rule = ({ s, target }) => {
  if (!s.PossibleSets.match(/(^| )desired(:[^\d]*([^$ ]*))?/)) {
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
 * A thermostat says nothing about whether it is heating. With a valve position it is heating
 * while the valve is open. Without one nothing is known, and it is shown as heating.
 */
export const heatingStateDefault: Rule = ({ target }) => {
  if (target.service_name !== 'thermostat') {
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
