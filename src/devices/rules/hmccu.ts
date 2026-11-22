// HomeMatic and HomeMatic IP devices behind a CCU, through the HMCCU modules (HMCCUCHN and HMCCUDEV).
//
// HMCCU derives its reading names from the ccu datapoints and the exact spelling depends on
// the ccureadingformat attribute: STATE, state, 1.STATE or ABC1234567:1.STATE are all the
// same datapoint. readings are therefore looked up by datapoint name instead of being hardcoded.
import { CustomUUIDs } from '../../accessory/customCharacteristics.ts';
import type { Mapping } from '../../mapping/types.ts';
import type { DetectionTarget } from '../detect.ts';
import type { Jsonlist2Device } from '../types.ts';

/** all readings that carry the datapoint, least qualified first */
export function hmccuReadings(s: Jsonlist2Device, datapoint: string): string[] {
  const re = new RegExp('^(.*[.:])?' + datapoint + '$', 'i');

  const readings: string[] = [];
  for (const reading in s.Readings) {
    if (reading.match(re)) {
      readings.push(reading);
    }
  }

  return readings.sort((a, b) => a.length - b.length || a.localeCompare(b));
}

/** the channel pinned by attr controldatapoint/statedatapoint for the datapoint, if any */
export function hmccuChannel(s: Jsonlist2Device, datapoint: string): string | undefined {
  for (const attr of ['controldatapoint', 'statedatapoint']) {
    const spec = s.Attributes[attr];
    if (!spec) {
      continue;
    }

    const match = spec.match(/^(?:.*:)?(\d+)\.(.+)$/);
    if (match && (match[2] as string).toUpperCase() === datapoint.toUpperCase()) {
      return match[1];
    }
  }

  return undefined;
}

/** the reading to use for the datapoint, honoring the pinned channel */
export function hmccuReading(s: Jsonlist2Device, datapoint: string): string | undefined {
  const readings = hmccuReadings(s, datapoint);
  if (!readings.length) {
    return undefined;
  }

  const channel = hmccuChannel(s, datapoint);
  if (channel !== undefined) {
    const re = new RegExp('(^|[.:])' + channel + '\\.' + datapoint + '$', 'i');
    for (const reading of readings) {
      if (reading.match(re)) {
        return reading;
      }
    }
  }

  return readings[0];
}

/** the [<channel>.]<datapoint> argument for 'set <device> datapoint ...' */
export function hmccuDatapoint(s: Jsonlist2Device, reading: string | undefined, datapoint: string): string {
  const match = reading ? reading.match(/(?:^|[.:])(\d+)\.[^.:]+$/) : null;
  if (match) {
    return match[1] + '.' + datapoint;
  }

  const channel = hmccuChannel(s, datapoint);
  if (channel !== undefined) {
    return channel + '.' + datapoint;
  }

  return datapoint;
}

/** true if HMCCU already scales LEVEL to 0-100 by way of attr ccuscaleval */
export function hmccuScalesLevel(s: Jsonlist2Device): boolean {
  if (!s.Attributes.ccuscaleval) {
    return false;
  }

  for (const spec of s.Attributes.ccuscaleval.split(',')) {
    const parts = spec.replace(/^!/, '').split(':') as [string, ...string[]];
    if (parts.length >= 2 && (parts[0] === '' || parts[0].match(/LEVEL$/i))) {
      return true;
    }
  }

  return false;
}

/**
 * The words HMCCU puts into a level reading in place of its ends, as the state values of the
 * device say: a light that is off has the LEVEL off, a blind that is open has the LEVEL open.
 */
const LEVEL_WORDS: Record<string, number> = { off: 0, closed: 0, on: 1, open: 1 };

/** a level that is a word in place of a number, as 0 or 1, the ends of the datapoint */
function levelOfWord(orig: string): number | undefined {
  return LEVEL_WORDS[orig.trim().toLowerCase()];
}

// LEVEL is a 0.0-1.0 datapoint, HomeKit wants 0-100
function level2homekit(mapping: Mapping, orig: string): number | undefined {
  const word = levelOfWord(orig);
  if (word !== undefined) {
    // the end of the range, whatever the reading is scaled to
    return word * 100;
  }

  let value = parseFloat(orig);
  if (isNaN(value)) {
    return undefined;
  }

  value = Math.round(value * (mapping.levelFactor as number));

  return value < 0 ? 0 : value > 100 ? 100 : value;
}

function homekit2level(mapping: Mapping, orig: number): number {
  return Math.round((orig / (mapping.levelWriteFactor as number)) * 1000) / 1000;
}

// slat position: the datapoint runs 0.0-1.0 (closed to open), homekit wants -90..90 degrees
function level2tilt(mapping: Mapping, orig: string): number | undefined {
  let value = parseFloat(orig);
  if (isNaN(value)) {
    return undefined;
  }

  value = Math.round(value * (mapping.levelFactor as number) * 1.8 - 90);

  return value < -90 ? -90 : value > 90 ? 90 : value;
}

function tilt2level(mapping: Mapping, orig: number): number {
  return Math.round(((orig + 90) / 1.8 / (mapping.levelWriteFactor as number)) * 1000) / 1000;
}

/** the level reading of a light or blind and its scale, as the log line names them */
function levelShown(s: Jsonlist2Device, sets: string, LEVEL: string, levelFactor: number): string {
  const PCT = sets.match(/(^| )pct\b/) ? hmccuReading(s, 'pct') : undefined;
  return PCT ? PCT + ' x1' : LEVEL + ' x' + levelFactor;
}

/**
 * Sets up the mappings for a HMCCUCHN/HMCCUDEV device. Returns false if the device is none of
 * the types handled here, in which case the general rules are left to recognise it.
 */
export function hmccuMappings(accessory: DetectionTarget, s: Jsonlist2Device, genericType: string | undefined): boolean {
  const log = accessory.log;
  const sets = s.PossibleSets || '';

  const ccutype = s.Internals.ccutype || '';
  const ccurole = (s.Internals.ccurole || s.Attributes.ccurole || '').toUpperCase();

  const hasOnOff = Boolean(sets.match(/(^| )on\b/) && sets.match(/(^| )off\b/));

  const LEVEL = hmccuReading(s, 'LEVEL');
  const STATE = hmccuReading(s, 'STATE');
  const SETPOINT = hmccuReading(s, 'SET_POINT_TEMPERATURE') || hmccuReading(s, 'SET_TEMPERATURE') || hmccuReading(s, 'SETPOINT');
  const ACTUAL = hmccuReading(s, 'ACTUAL_TEMPERATURE');
  const HUMIDITY = hmccuReading(s, 'HUMIDITY');

  const MOTION = hmccuReading(s, 'MOTION');
  const PRESENCE = hmccuReading(s, 'PRESENCE_DETECTION_STATE');
  const SMOKE = hmccuReading(s, 'SMOKE_DETECTOR_ALARM_STATUS');
  const WATER = hmccuReading(s, 'WATERLEVEL_DETECTED') || hmccuReading(s, 'MOISTURE_DETECTED');
  const LUX = hmccuReading(s, 'ILLUMINATION') || hmccuReading(s, 'CURRENT_ILLUMINATION') || hmccuReading(s, 'AVERAGE_ILLUMINATION');

  let type = genericType;
  if (type === undefined) {
    // contact roles have to be tested before the blind roles: SHUTTER_CONTACT would
    // otherwise be taken for a shutter actuator.
    if (ccurole.match(/(SHUTTER_CONTACT|CONTACT_TRANSCEIVER|ROTARY_HANDLE)/)) {
      type = 'contact';
    } else if (ccurole.match(/MOTIONDETECTOR/)) {
      type = 'motion';
    } else if (ccurole.match(/PRESENCEDETECTOR/)) {
      type = 'presence';
    } else if (ccurole.match(/SMOKE_DETECTOR/)) {
      type = 'smoke';
    } else if (ccurole.match(/(WATER_DETECTION|WATER_TRANSMITTER)/)) {
      type = 'leak';
    } else if (ccurole.match(/(BLIND|SHUTTER)/)) {
      type = 'blind';
    } else if (ccurole.match(/DIMMER/)) {
      type = 'light';
    } else if (ccurole.match(/(CLIMATECONTROL|THERMALCONTROL|HEATING)/)) {
      type = 'thermostat';
    } else if (ccurole.match(/SWITCH/)) {
      type = 'switch';
    } else if (ccutype.match(/(BROLL|FROLL|BBL|FBL|DRBLI|BLIND|-BL\d)/i)) {
      type = 'blind';
    } else if (ccutype.match(/(BDT|PDT|FDT|DIM)/i)) {
      type = 'light';
    } else if (ccutype.match(/(SWDO|SWDM|SCI|SRH)/i)) {
      type = 'contact';
    } else if (SETPOINT) {
      type = 'thermostat';
    } else if (MOTION) {
      type = 'motion';
    } else if (PRESENCE) {
      type = 'presence';
    } else if (SMOKE) {
      type = 'smoke';
    } else if (WATER) {
      type = 'leak';
      // a bare LEVEL/STATE datapoint is not enough on its own: sensors have those too, and
      // guessing actuator from them turns e.g. a window contact into a switch. only fall
      // back to them when the device also offers a way to actually set the datapoint.
    } else if (LEVEL && (hasOnOff || sets.match(/(^| )pct\b/))) {
      type = 'light';
    } else if (STATE && hasOnOff) {
      type = 'switch';
    }
  }

  if (type === undefined || !['blind', 'light', 'switch', 'outlet', 'thermostat', 'contact', 'motion', 'presence', 'smoke', 'leak'].includes(type)) {
    log.info(s.Internals.NAME + ' (' + (ccutype || '?') + '/' + (ccurole || '?') + '): no HMCCU mapping, using generic autodetection');
    return false;
  }

  const levelFactor = hmccuScalesLevel(s) ? 1 : 100;

  if (type === 'blind' || type === 'light') {
    if (!LEVEL) {
      log.error(s.Internals.NAME + ': detected as ' + type + ' but has no LEVEL reading');
      return false;
    }

    // 'set <device> pct' takes a percentage, 'set <device> datapoint' takes the raw datapoint
    const usePct = Boolean(sets.match(/(^| )pct\b/));
    const levelCmd = usePct ? 'pct' : 'datapoint ' + hmccuDatapoint(s, LEVEL, 'LEVEL');
    const writeFactor = usePct ? 1 : levelFactor;

    // a pct reading, as ccureadingname makes one, is the level in percent and stays a number
    // where HMCCU puts a word into LEVEL. it is read where the device is set by pct as well.
    const PCT = usePct ? hmccuReading(s, 'pct') : undefined;
    const levelReading = PCT ?? LEVEL;
    const readFactor = PCT ? 1 : levelFactor;

    if (!usePct && !sets.match(/(^| )datapoint\b/)) {
      log.warn(s.Internals.NAME + ': neither set pct nor set datapoint available, ' + type + ' will not be controllable');
    }

    if (type === 'blind') {
      accessory.service_name = 'blind';

      const currentPosition: Mapping = { reading: levelReading, levelFactor: readFactor };
      const targetPosition: Mapping = { reading: levelReading, cmd: levelCmd, delay: true, levelFactor: readFactor, levelWriteFactor: writeFactor };
      accessory.mappings.CurrentPosition = currentPosition;
      accessory.mappings.TargetPosition = targetPosition;

      currentPosition.reading2homekit = level2homekit.bind(null, currentPosition);
      targetPosition.reading2homekit = level2homekit.bind(null, targetPosition);
      targetPosition.homekit2reading = homekit2level.bind(null, targetPosition);

      // HmIP ACTIVITY_STATE / classic DIRECTION: 1 = up/opening, 2 = down/closing
      const ACTIVITY = hmccuReading(s, 'ACTIVITY_STATE') || hmccuReading(s, 'DIRECTION');
      if (ACTIVITY) {
        accessory.mappings.PositionState = {
          reading: ACTIVITY,
          values: ['/^(1|UP|up|OPENING|opening)$/:INCREASING', '/^(2|DOWN|down|CLOSING|closing)$/:DECREASING', '/.*/:STOPPED'],
        };
      }

      // venetian blinds (HmIP-BBL/FBL) expose the slat position as LEVEL_2. homekit wants a
      // tilt angle of -90..90, so 0.0 (slats closed) maps to -90 and 1.0 (slats open) to 90.
      // horizontal is assumed; use homebridgeMapping for blinds with vertical slats.
      const LEVEL_2 = hmccuReading(s, 'LEVEL_2');
      if (LEVEL_2) {
        const slatDatapoint = hmccuDatapoint(s, LEVEL_2, 'LEVEL_2');

        const currentTilt: Mapping = { reading: LEVEL_2, levelFactor: levelFactor };
        const targetTilt: Mapping = {
          reading: LEVEL_2,
          delay: true,
          cmd: 'datapoint ' + slatDatapoint,
          levelFactor: levelFactor,
          levelWriteFactor: levelFactor,
        };
        accessory.mappings.CurrentHorizontalTiltAngle = currentTilt;
        accessory.mappings.TargetHorizontalTiltAngle = targetTilt;

        currentTilt.reading2homekit = level2tilt.bind(null, currentTilt);
        targetTilt.reading2homekit = level2tilt.bind(null, targetTilt);
        targetTilt.homekit2reading = tilt2level.bind(null, targetTilt);
      }
    } else {
      accessory.service_name = 'light';

      // off is 0, also as the word HMCCU puts into LEVEL for it
      const on: Mapping = { reading: levelReading, valueOff: '/^(0(\\.0*)?|[Oo]ff|OFF)$/' };
      accessory.mappings.On = on;
      if (hasOnOff) {
        on.cmdOn = 'on';
        on.cmdOff = 'off';
      } else {
        const dp = hmccuDatapoint(s, LEVEL, 'LEVEL');
        on.cmdOn = 'datapoint ' + dp + ' ' + (levelFactor === 1 ? 100 : 1);
        on.cmdOff = 'datapoint ' + dp + ' 0';
      }

      const brightness: Mapping = { reading: levelReading, cmd: levelCmd, delay: true, levelFactor: readFactor, levelWriteFactor: writeFactor };
      accessory.mappings.Brightness = brightness;
      brightness.reading2homekit = level2homekit.bind(null, brightness);
      brightness.homekit2reading = homekit2level.bind(null, brightness);
    }
  } else if (type === 'switch' || type === 'outlet') {
    if (!STATE) {
      log.error(s.Internals.NAME + ': detected as ' + type + ' but has no STATE reading');
      return false;
    }

    accessory.service_name = type;
    const on: Mapping = { reading: STATE, valueOn: '/^(1|[Tt]rue|TRUE|[Oo]n|ON)$/' };
    accessory.mappings.On = on;

    if (hasOnOff) {
      on.cmdOn = 'on';
      on.cmdOff = 'off';
    } else {
      const dp = hmccuDatapoint(s, STATE, 'STATE');
      on.cmdOn = 'datapoint ' + dp + ' true';
      on.cmdOff = 'datapoint ' + dp + ' false';
    }
  } else if (type === 'thermostat') {
    if (!SETPOINT) {
      log.error(s.Internals.NAME + ': detected as thermostat but has no set point reading');
      return false;
    }

    accessory.service_name = 'thermostat';

    const tempCmd = sets.match(/(^| )desired-temp\b/) ? 'desired-temp' : 'datapoint ' + hmccuDatapoint(s, SETPOINT, 'SET_POINT_TEMPERATURE');

    accessory.mappings.TargetTemperature = { reading: SETPOINT, cmd: tempCmd, delay: true, minValue: 4.5, maxValue: 30.5, minStep: 0.5 };

    if (ACTUAL) {
      accessory.mappings.CurrentTemperature = { reading: ACTUAL, minValue: -30 };
    }

    if (HUMIDITY) {
      accessory.mappings.CurrentRelativeHumidity = { reading: HUMIDITY };
    }

    // valve position doubles as the heating indicator for eTRVs
    if (LEVEL) {
      accessory.mappings.CurrentHeatingCoolingState = { reading: LEVEL, values: ['/^0(\\.0*)?$/:OFF', '/.*/:HEAT'] };

      const valve: Mapping = {
        reading: LEVEL,
        name: 'Actuation',
        format: 'UINT8',
        unit: 'PERCENTAGE',
        minValue: 0,
        maxValue: 100,
        minStep: 1,
        levelFactor: levelFactor,
      };
      accessory.mappings[CustomUUIDs.Actuation] = valve;
      valve.reading2homekit = level2homekit.bind(null, valve);
    }

    const MODE = hmccuReading(s, 'CONTROL_MODE') || hmccuReading(s, 'SET_POINT_MODE');
    if (MODE && sets.match(/(^| )auto\b/) && sets.match(/(^| )manu\b/)) {
      accessory.mappings.TargetHeatingCoolingState = {
        reading: MODE,
        delay: true,
        values: ['/^(0|AUTO|auto|AUTO-MODE)$/:AUTO', '/.*/:HEAT'],
        cmds: ['AUTO:auto', 'HEAT:manu', 'COOL:manu', 'OFF:' + (sets.match(/(^| )off\b/) ? 'off' : 'manu')],
      };
    }
  } else if (type === 'contact') {
    if (!STATE) {
      log.error(s.Internals.NAME + ': detected as contact but has no STATE reading');
      return false;
    }

    accessory.service_name = 'contact';

    // HmIP-SWDO/SWDM: 0 = closed, 1 = open. HmIP-SRH: 0 = closed, 1 = tilted, 2 = open.
    accessory.mappings.ContactSensorState = {
      reading: STATE,
      values: ['/^(0|CLOSED|closed|[Ff]alse|FALSE)$/:CONTACT_DETECTED', '/.*/:CONTACT_NOT_DETECTED'],
    };
    accessory.mappings.CurrentDoorState = {
      reading: STATE,
      values: ['/^(0|CLOSED|closed|[Ff]alse|FALSE)$/:CLOSED', '/.*/:OPEN'],
    };
  } else if (type === 'motion') {
    if (!MOTION) {
      log.error(s.Internals.NAME + ': detected as motion sensor but has no MOTION reading');
      return false;
    }

    accessory.service_name = 'MotionSensor';
    accessory.mappings.MotionDetected = { reading: MOTION, valueOn: '/^(1|[Tt]rue|TRUE|[Oo]n|ON)$/' };
  } else if (type === 'presence') {
    if (!PRESENCE) {
      log.error(s.Internals.NAME + ': detected as presence sensor but has no PRESENCE_DETECTION_STATE reading');
      return false;
    }

    accessory.service_name = 'OccupancySensor';
    accessory.mappings.OccupancyDetected = {
      reading: PRESENCE,
      values: ['/^(1|[Tt]rue|TRUE)$/:OCCUPANCY_DETECTED', '/.*/:OCCUPANCY_NOT_DETECTED'],
    };
  } else if (type === 'smoke') {
    if (!SMOKE) {
      log.error(s.Internals.NAME + ': detected as smoke detector but has no SMOKE_DETECTOR_ALARM_STATUS reading');
      return false;
    }

    accessory.service_name = 'SmokeSensor';

    // 0 = IDLE_OFF, 1 = PRIMARY_ALARM, 2 = INTRUSION_ALARM, 3 = SECONDARY_ALARM
    accessory.mappings.SmokeDetected = {
      reading: SMOKE,
      values: ['/^(0|IDLE_OFF|idle_off)$/:SMOKE_NOT_DETECTED', '/.*/:SMOKE_DETECTED'],
    };
  } else {
    if (!WATER) {
      log.error(s.Internals.NAME + ': detected as leak sensor but has no water detection reading');
      return false;
    }

    accessory.service_name = 'LeakSensor';
    accessory.mappings.LeakDetected = {
      reading: WATER,
      values: ['/^(0|[Ff]alse|FALSE)$/:LEAK_NOT_DETECTED', '/.*/:LEAK_DETECTED'],
    };
  }

  // motion and presence detectors report brightness as their own light sensor service
  if (LUX && (type === 'motion' || type === 'presence')) {
    accessory.mappings['LightSensor#CurrentAmbientLightLevel'] = { reading: LUX, minValue: 0 };
  }

  // battery, common to all HmIP battery powered devices
  if (!s.Readings.battery) {
    const LOWBAT = hmccuReading(s, 'LOW_BAT') || hmccuReading(s, 'LOWBAT');
    if (LOWBAT) {
      accessory.mappings.StatusLowBattery = {
        reading: LOWBAT,
        values: ['/^(0|[Ff]alse|FALSE|ok|OK)$/:BATTERY_LEVEL_NORMAL', '/.*/:BATTERY_LEVEL_LOW'],
      };
    }
  }

  // power measurement, e.g. HmIP-PSM / HmIP-BSM
  const POWER = hmccuReading(s, 'POWER');
  const CURRENT = hmccuReading(s, 'CURRENT');
  const VOLTAGE = hmccuReading(s, 'VOLTAGE');
  const ENERGY = hmccuReading(s, 'ENERGY_COUNTER');

  if (POWER && !accessory.mappings[CustomUUIDs.Power]) {
    accessory.mappings[CustomUUIDs.Power] = { name: 'Power', reading: POWER, format: 'FLOAT', factor: 1 };
  }
  if (CURRENT && !accessory.mappings[CustomUUIDs.Current]) {
    accessory.mappings[CustomUUIDs.Current] = { name: 'Current', reading: CURRENT, format: 'FLOAT', factor: 0.001 };
  }
  if (VOLTAGE && !accessory.mappings[CustomUUIDs.Voltage]) {
    accessory.mappings[CustomUUIDs.Voltage] = { name: 'Voltage', reading: VOLTAGE, format: 'FLOAT', factor: 1 };
  }
  if (ENERGY && !accessory.mappings[CustomUUIDs.Energy]) {
    accessory.mappings[CustomUUIDs.Energy] = { name: 'Energy', reading: ENERGY, format: 'FLOAT', factor: 0.001 };
  }

  log.info(
    s.Internals.NAME +
      ' (' +
      (ccutype || '?') +
      '/' +
      (ccurole || '?') +
      ') mapped as HMCCU ' +
      type +
      (LEVEL ? '; LEVEL=' + levelShown(s, sets, LEVEL, levelFactor) : '') +
      (STATE ? '; STATE=' + STATE : '') +
      (SETPOINT ? '; setpoint=' + SETPOINT : ''),
  );

  return true;
}
