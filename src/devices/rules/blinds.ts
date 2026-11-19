// blinds, windows and garage doors: things that open and close
import type { Mapping } from '../../mapping/types.ts';
import { looselyEqual } from '../../util/loose.ts';
import type { Rule } from '../detect.ts';

/** which way a blind is moving, from the reading its module reports that in */
export const positionState: Rule = ({ s, target }) => {
  if (s.Readings.motor) {
    target.mappings.PositionState = { reading: 'motor', values: ['/^up/:INCREASING', '/^down/:DECREASING', '/.*/:STOPPED'] };
  }

  if (s.Readings.moving) {
    target.mappings.PositionState = { reading: 'moving', values: ['/^up/:INCREASING', '/^down/:DECREASING', '/.*/:STOPPED'] };
  }

  if (s.Readings.direction) {
    target.mappings.PositionState = { reading: 'direction', values: ['/^opening/:INCREASING', '/^closing/:DECREASING', '/.*/:STOPPED'] };
  }
  return false;
};

export const doorState: Rule = ({ s, target }) => {
  if (!s.Readings.doorState) {
    return false;
  }

  target.mappings.CurrentDoorState = {
    reading: 'doorState',
    values: ['/^opening/:OPENING', '/^closing/:CLOSING', '/^open/:OPEN', '/^closed/:CLOSED', '/.*/:STOPPED'],
  };
  return true;
};

/** genericDeviceType garage: the two commands of the setList open and close the door */
export const garage: Rule = ({ s, target, genericType }) => {
  if (genericType !== 'garage') {
    return false;
  }

  target.service_name = 'garage';
  // a device that could have a setList but has none is given `on off`, for the rules that follow as well
  if (s.PossibleAttrs.match(/(^| )setList\b/) && !s.Attributes.setList) {
    s.Attributes.setList = 'on off';
  }
  if (s.Attributes.setList) {
    const parts = s.Attributes.setList.split(' ');
    if (parts.length === 2) {
      const [open, closed] = parts as [string, string];
      target.mappings.CurrentDoorState = { reading: 'state', values: [open + ':OPEN', closed + ':CLOSED'] };
      target.mappings.TargetDoorState = {
        reading: 'state',
        values: [open + ':OPEN', closed + ':CLOSED'],
        cmds: ['OPEN:' + open, 'CLOSED:' + closed],
      };
    }
  }
  return true;
};

export const blind: Rule = ({ s, target, genericType }) => {
  if (genericType !== 'blind' && s.Internals.type !== 'blind' && s.Attributes.subType !== 'blind' && s.Attributes.subType !== 'blindActuator') {
    return false;
  }

  // a blind that is set with `set pct` was already taken for a light by the dimmer rule, and
  // stays one.
  if (!target.service_name) {
    target.service_name = 'blind';
  }
  delete target.mappings.Brightness;

  let currentPosition: Mapping;
  let targetPosition: Mapping;
  if (s.PossibleSets.match(/(^| )position\b/)) {
    currentPosition = { reading: 'position' };
    targetPosition = { reading: 'position', cmd: 'position', delay: true };
    if (s.Internals.TYPE === 'DUOFERN') {
      currentPosition.invert = true;
      targetPosition.invert = true;
    } else if (s.Internals.TYPE === 'SOMFY') {
      if (!s.Attributes.positionInverse || s.Attributes.positionInverse !== '1') {
        currentPosition.invert = true;
        targetPosition.invert = true;
      }
      targetPosition.cmd = 'pos';
    }
  } else {
    currentPosition = { reading: 'pct' };
    targetPosition = { reading: 'pct', cmd: 'pct', delay: true };
    if (s.Attributes.param?.match(/levelInverse/i)) {
      currentPosition.invert = true;
      targetPosition.invert = true;
    }
  }
  target.mappings.CurrentPosition = currentPosition;
  target.mappings.TargetPosition = targetPosition;
  return true;
};

/** the HomeMatic window drive: the state is the opening in percent, or `locked` */
export const hmSecWin: Rule = ({ s, target }) => {
  if (s.Attributes.model !== 'HM-SEC-WIN') {
    return false;
  }

  if (!target.service_name) {
    target.service_name = 'window';
  }
  const currentPosition: Mapping = { reading: 'state' };
  const targetPosition: Mapping = { reading: 'state', cmd: ' ', delay: true };
  target.mappings.CurrentPosition = currentPosition;
  target.mappings.TargetPosition = targetPosition;

  currentPosition.reading2homekit = winState2position.bind(null, currentPosition);
  targetPosition.reading2homekit = winState2position.bind(null, targetPosition);
  targetPosition.homekit2reading = position2winCommand.bind(null, targetPosition);
  return true;
};

function winState2position(_mapping: Mapping, orig: string): number {
  const match = orig.match(/^(\d+)/);
  if (match) {
    return parseInt(match[1] as string);
  } else if (orig === 'locked') {
    return 0;
  }

  return 50;
}

function position2winCommand(_mapping: Mapping, orig: unknown): unknown {
  if (looselyEqual(orig, 0)) {
    return 'lock';
  }
  return orig;
}
