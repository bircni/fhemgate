// anything that can be switched and was not recognised as something more specific
import type { Mapping } from '../../mapping/types.ts';
import type { Rule } from '../detect.ts';

/** `set on` and `set off` */
export const onOff: Rule = ({ s, target, isHMCCU }) => {
  if (isHMCCU || target.mappings.On || !s.PossibleSets.match(/(^| )on\b/) || !s.PossibleSets.match(/(^| )off\b/)) {
    return false;
  }

  if (!target.service_name) {
    target.service_name = 'switch';
  }
  const on: Mapping = { reading: 'state', valueOff: '/off|A0|000000/', cmdOn: 'on', cmdOff: 'off' };
  target.mappings.On = on;
  if (!s.Readings.state) {
    delete on.reading;
  }
  return true;
};

/** a setList of exactly two commands: the first switches on, the second off */
export const setList: Rule = ({ s, target }) => {
  if ((target.service_name && target.service_name !== 'switch') || !s.Attributes.setList) {
    return false;
  }

  const parts = s.Attributes.setList.split(' ');
  if (parts.length === 2) {
    const [first, second] = parts as [string, string];
    if (!target.service_name) {
      target.service_name = 'switch';
    }
    const on: Mapping = { reading: 'state', valueOn: first, cmdOn: first, cmdOff: second };
    target.mappings.On = on;
    if (!s.Readings.state) {
      delete on.reading;
    }
  }
  return true;
};
