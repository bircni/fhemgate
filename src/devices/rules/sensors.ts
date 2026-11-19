// what a device senses, recognised by its readings
import { CustomUUIDs } from '../../accessory/customCharacteristics.ts';
import type { Mapping } from '../../mapping/types.ts';
import type { PluginState } from '../../state/pluginState.ts';
import type { Rule } from '../detect.ts';

export const lightLevel: Rule = ({ s, target }) => {
  if (s.Attributes.model?.toUpperCase() === 'HM-SEN-LI-O') {
    target.service_name = 'LightSensor';
    target.mappings.CurrentAmbientLightLevel = { reading: 'brightness', minValue: 0 };
  } else if (s.Readings.luminance) {
    if (!target.service_name) {
      target.service_name = 'LightSensor';
    }
    target.mappings.CurrentAmbientLightLevel = { reading: 'luminance', minValue: 0 };
  } else if (s.Readings.illuminance) {
    if (!target.service_name) {
      target.service_name = 'LightSensor';
    }
    target.mappings.CurrentAmbientLightLevel = { reading: 'illuminance', minValue: 0 };
  } else if (s.Readings.luminosity) {
    if (!target.service_name) {
      target.service_name = 'LightSensor';
    }
    target.mappings.CurrentAmbientLightLevel = { reading: 'luminosity', minValue: 0, factor: 1 / 0.265 };
  } else {
    return false;
  }
  return true;
};

/** the air quality is judged from the voc or co2 concentration in ppm */
export const airQuality: Rule = ({ s, target, state }) => {
  let mapping: Mapping;
  if (s.Readings.voc) {
    if (!target.service_name) {
      target.service_name = 'AirQualitySensor';
    }
    mapping = { reading: 'voc' };
    target.mappings.AirQuality = mapping;
  } else if (s.Readings.co2) {
    if (!target.service_name) {
      target.service_name = 'AirQualitySensor';
    }
    mapping = { reading: 'co2' };
    target.mappings.AirQuality = mapping;
    target.mappings.CarbonDioxideLevel = { reading: 'co2' };
  } else {
    return false;
  }

  mapping.reading2homekit = ppm2airQuality.bind(null, state, mapping);
  return true;
};

function ppm2airQuality(state: PluginState, _mapping: Mapping, orig: string): number {
  const { AirQuality } = state.hap.Characteristic;
  const ppm = parseInt(orig);
  if (ppm > 1500) {
    return AirQuality.POOR;
  } else if (ppm > 1000) {
    return AirQuality.INFERIOR;
  } else if (ppm > 800) {
    return AirQuality.FAIR;
  } else if (ppm > 600) {
    return AirQuality.GOOD;
  } else if (ppm > 0) {
    return AirQuality.EXCELLENT;
  } else {
    return AirQuality.UNKNOWN;
  }
}

/** a battery reading is either a level in percent, or `ok` and anything else */
export const battery: Rule = ({ s, target }) => {
  if (!s.Readings.battery) {
    return false;
  }

  const value = parseInt(s.Readings.battery.Value);

  if (isNaN(value)) {
    target.mappings.StatusLowBattery = { reading: 'battery', values: ['ok:BATTERY_LEVEL_NORMAL', '/.*/:BATTERY_LEVEL_LOW'] };
  } else {
    target.mappings.BatteryLevel = { reading: 'battery' };
    target.mappings.StatusLowBattery = { reading: 'battery', threshold: 20, values: ['0:BATTERY_LEVEL_LOW', '1:BATTERY_LEVEL_NORMAL'] };
  }
  return true;
};

export const firmware: Rule = ({ s, target }) => {
  if (s.Readings['D-firmware']) {
    target.mappings.FirmwareRevision = { reading: 'D-firmware', _isInformation: true };
  } else if (s.Readings.firmware) {
    target.mappings.FirmwareRevision = { reading: 'firmware', _isInformation: true };
  } else {
    return false;
  }
  //FIXME: add swversion internal for HUEDevices
  return true;
};

export const reachable: Rule = ({ s, target }) => {
  if (!s.Readings.reachable) {
    return false;
  }

  target.mappings.Reachable = { reading: 'reachable' };
  return true;
};

/** the window contact of the FHT80 */
export const fhttk: Rule = ({ s, target }) => {
  if (s.Internals.TYPE !== 'CUL_FHTTK') {
    return false;
  }

  if (!target.service_name) {
    target.service_name = 'ContactSensor';
  }
  target.mappings.ContactSensorState = { reading: 'Window', values: ['/^Closed/:CONTACT_DETECTED', '/.*/:CONTACT_NOT_DETECTED'] };
  target.mappings.CurrentDoorState = { reading: 'Window', values: ['/^Closed/:CLOSED', '/.*/:OPEN'] };
  return true;
};

export const maxShutterContact: Rule = ({ s, target }) => {
  if (s.Internals.TYPE !== 'MAX' || s.Internals.type !== 'ShutterContact') {
    return false;
  }

  target.service_name = 'ContactSensor';
  target.mappings.ContactSensorState = { reading: 'state', values: ['closed:CONTACT_DETECTED', '/.*/:CONTACT_NOT_DETECTED'] };
  target.mappings.CurrentDoorState = { reading: 'state', values: ['closed:CLOSED', '/.*/:OPEN'] };
  return true;
};

/** the HomeMatic contacts with the states closed, tilted and open */
export const threeStateSensor: Rule = ({ s, target }) => {
  if (s.Attributes.subType !== 'threeStateSensor') {
    return false;
  }

  if (!target.service_name) {
    target.service_name = 'ContactSensor';
  }
  target.mappings.ContactSensorState = { reading: 'contact', values: ['/^closed/:CONTACT_DETECTED', '/.*/:CONTACT_NOT_DETECTED'] };
  target.mappings.CurrentDoorState = { reading: 'contact', values: ['/^closed/:CLOSED', '/.*/:OPEN'] };
  return true;
};

export const temperature: Rule = ({ s, target }) => {
  if (s.Readings['measured-temp']) {
    if (!target.service_name) {
      target.service_name = 'thermometer';
    }
    target.mappings.CurrentTemperature = { reading: 'measured-temp', minValue: -30 };
  } else if (s.Readings.temperature) {
    if (!target.service_name) {
      target.service_name = 'thermometer';
    }
    target.mappings.CurrentTemperature = { reading: 'temperature', minValue: -30 };
  } else {
    return false;
  }
  return true;
};

export const humidity: Rule = ({ s, target }) => {
  if (!s.Readings.humidity) {
    return false;
  }

  if (!target.service_name) {
    target.service_name = 'HumiditySensor';
  }
  target.mappings.CurrentRelativeHumidity = { reading: 'humidity' };
  return true;
};

export const pressure: Rule = ({ s, target }) => {
  if (!s.Readings.pressure) {
    return false;
  }

  target.mappings[CustomUUIDs.AirPressure] = { name: 'AirPressure', reading: 'pressure', format: 'UINT16', factor: 1 };
  return true;
};
