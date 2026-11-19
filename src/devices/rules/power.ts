// what a device measures of the power it switches, shown with the characteristics Eve knows
import { CustomUUIDs } from '../../accessory/customCharacteristics.ts';
import type { Mapping } from '../../mapping/types.ts';
import type { Jsonlist2Device } from '../types.ts';
import type { Rule } from '../detect.ts';

/** the HomeMatic power meter plugs report milliampere and watt hours */
function isHomematicPowerMeter(s: Jsonlist2Device): boolean {
  const model = s.Attributes.model;
  return !!model && (model.toUpperCase() === 'HM-ES-PMSW1-PL' || model.toUpperCase() === 'HM-ES-PMSW1-PL-DN-R1');
}

export const voltage: Rule = ({ s, target }) => {
  if (!s.Readings.voltage) {
    return false;
  }

  target.mappings[CustomUUIDs.Voltage] = { name: 'Voltage', reading: 'voltage', format: 'FLOAT', factor: 1 };
  return true;
};

export const current: Rule = ({ s, target }) => {
  if (!s.Readings.current) {
    return false;
  }

  const mapping: Mapping = { name: 'Current', reading: 'current', format: 'FLOAT', factor: 1 };
  target.mappings[CustomUUIDs.Current] = mapping;
  if (isHomematicPowerMeter(s)) {
    mapping.factor = 0.001;
  }
  return true;
};

export const power: Rule = ({ s, target }) => {
  if (!s.Readings.power) {
    return false;
  }

  target.mappings[CustomUUIDs.Power] = { name: 'Power', reading: 'power', format: 'FLOAT', factor: 1 };
  return true;
};

export const energy: Rule = ({ s, target }) => {
  if (!s.Readings.energy) {
    return false;
  }

  const mapping: Mapping = { name: 'Energy', reading: 'energy', format: 'FLOAT', factor: 1 };
  target.mappings[CustomUUIDs.Energy] = mapping;
  if (isHomematicPowerMeter(s)) {
    mapping.factor = 0.001;
  } else if (s.Readings.energy.Value.match(/ Wh/)) {
    mapping.factor = 0.001;
  }
  return true;
};
