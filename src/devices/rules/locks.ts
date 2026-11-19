// door locks. opening the door is a push button: TargetDoorState falls back to CLOSED half a second after it was set.
import type { Rule } from '../detect.ts';

/** the HomeMatic KeyMatic */
export const hmSecKey: Rule = ({ s, target }) => {
  if (!s.Attributes.model?.match(/^HM-SEC-KEY/)) {
    return false;
  }

  if (!target.service_name) {
    target.service_name = 'lock';
  }
  target.mappings.TargetDoorState = { reading: '', default: 'CLOSED', timeout: 500, cmds: ['OPEN:open'] };
  target.mappings.LockCurrentState = { reading: 'lock', values: ['/uncertain/:UNKNOWN', '/^locked/:SECURED', '/.*/:UNSECURED'] };
  target.mappings.LockTargetState = {
    reading: 'lock',
    values: ['/^locked/:SECURED', '/.*/:UNSECURED'],
    cmds: ['SECURED:lock', 'UNSECURED:unlock'],
  };
  return true;
};

/** genericDeviceType lock: the state reads locked or unlocked, and is set with `set lock locked` */
export const lock: Rule = ({ target, genericType }) => {
  if (genericType !== 'lock') {
    return false;
  }

  target.mappings.TargetDoorState = { reading: '', default: 'CLOSED', timeout: 500, cmds: ['OPEN:open'] };
  target.mappings.LockCurrentState = { reading: 'state', values: ['/uncertain/:UNKNOWN', '/^locked/:SECURED', '/.*/:UNSECURED'] };
  target.mappings.LockTargetState = {
    reading: 'state',
    values: ['/^locked/:SECURED', '/.*/:UNSECURED'],
    cmds: ['SECURED:lock+locked', 'UNSECURED:lock+unlocked'],
  };
  return true;
};
