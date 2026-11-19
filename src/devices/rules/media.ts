// players and remote controls
import { CustomUUIDs } from '../../accessory/customCharacteristics.ts';
import type { Mapping } from '../../mapping/types.ts';
import { looselyEqual } from '../../util/loose.ts';
import type { Rule } from '../detect.ts';

/** a volume reading becomes the volume characteristic Eve knows */
export const volume: Rule = ({ s, target }) => {
  if (s.Readings.volume) {
    target.mappings[CustomUUIDs.Volume] = {
      reading: 'volume', cmd: 'volume', delay: true,
      name: 'Volume', format: 'UINT8', unit: 'PERCENTAGE',
      minValue: 0, maxValue: 100, minStep: 1,
    };
    return true;
  }

  if (s.Readings.Volume) {
    // SONOS does not send events for its volume unless asked to, so it is not cached
    const mapping: Mapping = {
      reading: 'Volume', cmd: 'Volume', delay: true, nocache: true,
      name: 'Volume', format: 'UINT8', unit: 'PERCENTAGE',
      minValue: 0, maxValue: 100, minStep: 1,
    };
    target.mappings[CustomUUIDs.Volume] = mapping;
    if (looselyEqual(s.Attributes.generateVolumeEvent, 1)) {
      delete mapping.nocache;
    }
    return true;
  }

  return false;
};

/** a SONOS player is a switch that plays and pauses */
export const sonos: Rule = ({ s, target }) => { //FIXME: use sets [Pp]lay/[Pp]ause/[Ss]top
  if (s.Internals.TYPE !== 'SONOSPLAYER') {
    return false;
  }

  if (!target.service_name) {
    target.service_name = 'switch';
  }
  target.mappings.On = { reading: 'transportState', valueOn: 'PLAYING', cmdOn: 'play', cmdOff: 'pause' };
  return true;
};

/**
 * A harmony hub gets one switch per activity. The devices behind a hub are only published when
 * they have a genericDeviceType.
 */
export const harmony: Rule = ({ s, target }) => {
  if (s.Internals.TYPE !== 'harmony') {
    return false;
  }

  if (s.Internals.id !== undefined) {
    if (s.Attributes.genericDeviceType) {
      target.mappings.On = { reading: 'power', cmdOn: 'on', cmdOff: 'off' };
    } else {
      return 'stop';
    }
  } else if (!s.Attributes.homebridgeMapping) {
    if (!target.service_name) {
      target.service_name = 'switch';
    }

    const match = s.PossibleSets.match(/(^| )activity:([^\s]*)/);
    if (match) {
      const activities: Mapping[] = [];
      target.mappings.On = activities;

      for (const activity of (match[2] as string).split(',')) {
        activities.push({ reading: 'activity', subtype: activity, valueOn: activity, cmdOn: 'activity+' + activity, cmdOff: 'off' });
      }
    }
  }
  return true;
};
