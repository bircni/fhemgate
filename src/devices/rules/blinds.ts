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

/** the modules whose devices with a position command are roller shutters */
const shutterModules = new Set(['DUOFERN', 'SOMFY']);

/** stops the blind when HomeKit sets the characteristic. HomeKit never sets it to false, and nothing is sent if it does. */
function holdPosition2stop(_mapping: Mapping, hold: unknown): number | undefined {
  return hold ? 1 : undefined;
}

export const blind: Rule = ({ s, target, genericType }) => {
  // a DUOFERN or SOMFY device that is set to a position is a blind without being told so, unless the user says what else it is
  const shutter = genericType === undefined && shutterModules.has(s.Internals.TYPE) && /(^| )position\b/.test(s.PossibleSets);
  if (!shutter && genericType !== 'blind' && s.Internals.type !== 'blind' && s.Attributes.subType !== 'blind' && s.Attributes.subType !== 'blindActuator') {
    return false;
  }

  // the 'set pct' rule already claimed the service as a light. that guess only wins when
  // the user did not ask for a specific type, otherwise a blindActuator ends up exposed as
  // a Lightbulb instead of a WindowCovering.
  if (!target.service_name || (target.service_name === 'light' && genericType === undefined)) {
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

  // HomeKit sets HoldPosition to stop a blind where it is. it has no reading to follow.
  if (s.PossibleSets.match(/(^| )stop\b/)) {
    const holdPosition: Mapping = { cmdOn: 'stop', default: false };
    holdPosition.homekit2reading = holdPosition2stop.bind(null, holdPosition);
    target.mappings.HoldPosition = holdPosition;
  }
  return true;
};

/**
 * genericDeviceType window. A window has no brightness, whatever the command it is set with made
 * the dimmer rules think. One that is set with `set pct` is opened that far, like a blind.
 */
export const window: Rule = ({ s, target, genericType }) => {
  if (genericType !== 'window') {
    return false;
  }

  delete target.mappings.Brightness;

  if (!s.PossibleSets.match(/(^| )pct\b/)) {
    return false;
  }

  target.mappings.CurrentPosition = { reading: 'pct' };
  target.mappings.TargetPosition = { reading: 'pct', cmd: 'pct', delay: true };
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
