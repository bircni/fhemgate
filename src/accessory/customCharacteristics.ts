// characteristics HomeKit itself does not define. apps like Eve show them when they know the uuid.

/** the characteristics a mapping can name, and the detection uses */
export const CustomUUIDs = {
  //                    F H E M       h o  m e  b r i d g e
  xVolume: '4648454d-0101-686F-6D65-627269646765',

  // see: https://github.com/ebaauw/homebridge-hue/wiki/Characteristics
  CT: 'E887EF67-509A-552D-A138-3DA215050F46',

  // used in YamahaAVRPlatform, recognized by EVE
  Volume: '00001001-0000-1000-8000-135D67EC4377',

  // see: https://gist.github.com/gomfunkel/b1a046d729757120907c
  Voltage: 'E863F10A-079E-48FF-8F27-9C2605A29F52',
  Current: 'E863F126-079E-48FF-8F27-9C2605A29F52',
  Power: 'E863F10D-079E-48FF-8F27-9C2605A29F52',
  Energy: 'E863F10C-079E-48FF-8F27-9C2605A29F52',
  AirPressure: 'E863F10F-079E-48FF-8F27-9C2605A29F52',
  Actuation: 'E863F12E-079E-48FF-8F27-9C2605A29F52',
} as const;

/** the characteristics Eve keeps its history counters in */
export const EveUUIDs = {
  Reset: 'E863F112-079E-48FF-8F27-9C2605A29F52',
  TimesOpened: 'E863F129-079E-48FF-8F27-9C2605A29F52',
  LastActivation: 'E863F11A-079E-48FF-8F27-9C2605A29F52',
  OpenDuration: 'E863F118-079E-48FF-8F27-9C2605A29F52',
  ClosedDuration: 'E863F119-079E-48FF-8F27-9C2605A29F52',
} as const;
