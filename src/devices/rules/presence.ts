// who is at home
import type { Rule } from '../detect.ts';

export const presence: Rule = ({ s, target }) => {
  if (s.Internals.TYPE !== 'PRESENCE') {
    return false;
  }

  if (!target.service_name) {
    target.service_name = 'OccupancySensor';
  }
  target.mappings.OccupancyDetected = { reading: 'state', values: ['present:OCCUPANCY_DETECTED', 'absent:OCCUPANCY_NOT_DETECTED'] };
  return true;
};

export const roommateOrGuest: Rule = ({ s, target }) => {
  if (s.Internals.TYPE !== 'ROOMMATE' && s.Internals.TYPE !== 'GUEST') {
    return false;
  }

  if (!target.service_name) {
    target.service_name = 'OccupancySensor';
  }
  target.mappings.OccupancyDetected = { reading: 'presence', values: ['present:OCCUPANCY_DETECTED', '/.*/:OCCUPANCY_NOT_DETECTED'] };
  return true;
};

/** the residents of a home together are shown as a security system: armed when nobody is home */
export const residents: Rule = ({ s, target }) => {
  if (s.Internals.TYPE !== 'RESIDENTS') {
    return false;
  }

  if (!target.service_name) {
    target.service_name = 'security';
  }
  target.mappings.SecuritySystemCurrentState = {
    reading: 'state',
    values: ['/^home/:DISARMED', '/^gotosleep/:NIGHT_ARM', '/^absent/:STAY_ARM', '/^gone/:AWAY_ARM'],
  };
  // HomeKit names the state without an alarm DISARMED where it is, and DISARM where it is asked for
  target.mappings.SecuritySystemTargetState = {
    reading: 'state',
    values: ['/^home/:DISARM', '/^gotosleep/:NIGHT_ARM', '/^absent/:STAY_ARM', '/^gone/:AWAY_ARM'],
    cmds: ['STAY_ARM:home', 'AWAY_ARM:absent', 'NIGHT_ARM:gotosleep', 'DISARM:home'],
    delay: true,
  };
  return true;
};
