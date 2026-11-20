# Devices

The plugin looks at the set commands, readings and attributes of each device the
[filter](configuration.md#filter) selects and works out what it is in HomeKit. This page lists what
is recognised without any help, and how to say what a device is when the guess is wrong or there is
none.

- [Saying what a device is: genericDeviceType](#saying-what-a-device-is-genericdevicetype)
- [What is recognised automatically](#what-is-recognised-automatically)
- [HomeMatic IP and HomeMatic by way of HMCCU](#homematic-ip-and-homematic-by-way-of-hmccu)
- [Names and identity](#names-and-identity)
- [Checking what was detected](#checking-what-was-detected)

For anything the detection does not get right in detail, readings with other names or commands of
your own, use the [`homebridgeMapping` attribute](mapping.md).

## Saying what a device is: genericDeviceType

```
attr <device> genericDeviceType <type>
```

The plugin adds the attribute to FHEM the first time it connects. If FHEM refuses it as an unknown
attribute, start Homebridge once with the platform configured.

| `genericDeviceType` | HomeKit service |
| --- | --- |
| `switch` | Switch |
| `outlet` | Outlet |
| `light` | Lightbulb |
| `blind` | WindowCovering |
| `window` | Window |
| `garage` | GarageDoorOpener |
| `lock` | LockMechanism |
| `thermostat` | Thermostat |
| `thermometer` | TemperatureSensor |
| `contact` | ContactSensor |
| `security` | SecuritySystem |
| `ignore` | none: the device is not published |

The name of any other HomeKit service works as well, written as HAP-NodeJS names it, for example
`MotionSensor`, `OccupancySensor`, `Fan`, `Television` or `StatelessProgrammableSwitch`. The
drop-down list in FHEM only offers the values of the table; type other names with
`attr <device> genericDeviceType MotionSensor`. Such a service usually needs a `homebridgeMapping`
that says where its characteristics come from. A name that is no service is reported in the log
with `service name ... unknown`, and the device becomes a switch.

Notes:

- `genericDeviceType` is mostly needed to tell a light from a switch: a device with `on` and `off`
  is a switch unless it can be dimmed or coloured.
- A device without `genericDeviceType` that has a `genericDisplayType` attribute is given that type.
- Devices of the FHEM types `structure`, `SVG` and `THRESHOLD` are only published with a
  `genericDeviceType`.
- A device nothing is recognised for is not published. The log has
  `<device>: no service type detected`.

## What is recognised automatically

The first match in this table decides the service, unless `genericDeviceType` says otherwise. The
characteristics of the later matches are added all the same: a switch with a `temperature` reading
is a switch that also shows a temperature.

### Lights

| Device has | Becomes | Details |
| --- | --- | --- |
| `set dim` with a slider from 0 to 99 (ZWave) | light with brightness | brightness from the `state` reading (`dim 50`) |
| `set bri` (HUEDevice) | light with brightness | on from `onoff`, brightness from `bri`, set with `set pct` |
| `set pct` (HomeMatic) | light with brightness | on and brightness from `pct` |
| `set dim06%` ... `dim100%` (FS20) | light with brightness | brightness from `state`, set to the nearest of the sixteen steps |
| attribute `model` is `fs20di` | light | |
| `set hue` | light with hue | range from the slider of the command, else 0 to 359 |
| `set sat` | light with saturation | range from the slider of the command, else 0 to 100 |
| type `MilightDevice` with `set dim` | light | brightness from `brightness`; hue and saturation if `set hue` and `set saturation` exist |
| type `WifiLight` with `set HSV` | light | hue, saturation and brightness, sent together as `set HSV h,s,v` |
| `set rgb` or `set RGB`, and no `set hue` | light | hue, saturation and brightness worked out from the `rgb` or `RGB` reading |
| type `SWAP_0000002200000003` with `set rgb` | light | as above, from the reading `0B-RGBlevel` |
| `set ct` and a `ct` reading | light with colour temperature | in mired, range from the widget of the command within the 140 to 500 HomeKit allows |

A light that reports the readings `colormode` and `xy` or `ct`, like a HUEDevice, also shows the
right colour in HomeKit after it was set as xy colour or as colour temperature.

### Switches

| Device has | Becomes | Details |
| --- | --- | --- |
| `set on` and `set off` | switch | off when `state` matches `off`, `A0` or `000000`, on otherwise |
| attribute `setList` with exactly two commands | switch | the first command switches on, the second off; on when `state` is the first |
| type `SONOSPLAYER` | switch | on while `transportState` is `PLAYING`; `set play` and `set pause` |
| type `harmony`, the hub | one switch per activity | on while `activity` is that activity; `set activity <name>` and `set off` |
| type `harmony`, a device of the hub | not published | with a `genericDeviceType`: on from `power`, `set on` and `set off` |

The `eventMap` attribute of a device is honoured for entries that map to `on` or `off`.

### Blinds, windows and doors

| Device has | Becomes | Details |
| --- | --- | --- |
| type `DUOFERN` or `SOMFY` with `set position` | blind | position inverted; SOMFY is set with `set pos`, and not inverted with `attr positionInverse 1` |
| `genericDeviceType blind`, or attribute `subType` `blind` or `blindActuator` (HomeMatic), or internal `type` `blind` | blind | `position` and `set position` if the command exists, else `pct` and `set pct`; inverted for a `param` attribute with `levelInverse` |
| a blind with `set stop` | | can be stopped from HomeKit |
| reading `motor`, `moving` or `direction` | | which way the blind is moving |
| attribute `model` is `HM-SEC-WIN` | window | position from `state`, 0 for `locked`; position 0 sends `set lock` |
| `genericDeviceType window` with `set pct` | window | position from `pct` |
| `genericDeviceType garage` | garage door | the two commands of the `setList` attribute open and close; `on off` for a device that can have a `setList` and has none |
| reading `doorState` | | current door state: `open`, `closed`, `opening`, `closing` |

HomeKit counts how far a blind is open: 100 is open. See
[blinds in the troubleshooting](troubleshooting.md#blinds) for devices that count the other way.

### Locks

| Device has | Becomes | Details |
| --- | --- | --- |
| attribute `model` starts with `HM-SEC-KEY` | lock | state from the `lock` reading; `set lock`, `set unlock`, and `set open` as a push button |
| `genericDeviceType lock` | lock | state from `state` (`locked`); `set lock locked`, `set lock unlocked`, `set open` |

### Thermostats

| Device has | Becomes | Details |
| --- | --- | --- |
| `set desired-temp` (HomeMatic, Comet DECT) | thermostat | target from `desired-temp`, or from `temperature` if that reading does not exist; valve from `actuator` or `ValvePosition`; with `set mode` the modes off, heat and auto |
| `set desiredTemperature` (MAX) | thermostat | target from `desiredTemperature`; valve from `valveposition` |
| `set desired` (PID20) | thermostat | target from `desired`; current from `measured`; valve from `actuation` |
| `genericDeviceType thermostat` or attribute `subType` `thermostat` | thermostat | needs one of the commands above, or a mapping for `TargetTemperature` |

- The range and the steps of the target temperature are taken from the widget of the set command.
- The current temperature comes from `measured-temp` or `temperature`.
- A thermostat with a valve position is shown as heating while the valve is open. One without is
  always shown as heating.
- HomeKit only offers the modes the device has commands for. See
  [thermostat modes](troubleshooting.md#a-thermostat-offers-modes-it-does-not-have).
- A device that is a thermostat but has no command for the target temperature is reported with
  `is NOT a thermostat`.

### Sensors

| Device has | Becomes | Details |
| --- | --- | --- |
| reading `measured-temp` or `temperature` | temperature sensor | down to -30 degrees |
| reading `humidity` | humidity sensor | |
| reading `pressure` | | air pressure, shown by the Eve app |
| reading `luminance`, `illuminance` or `luminosity` | light sensor | |
| attribute `model` is `HM-Sen-LI-O` | light sensor | from the `brightness` reading |
| reading `voc` or `co2` (CO20, netatmo) | air quality sensor | judged from the ppm value: up to 600 excellent, 800 good, 1000 fair, 1500 inferior, above poor; `co2` also as carbon dioxide level |
| type `CUL_FHTTK` | contact sensor | from the `Window` reading |
| type `MAX` with internal `type` `ShutterContact` | contact sensor | from `state` |
| attribute `subType` is `threeStateSensor` (HomeMatic) | contact sensor | from the `contact` reading; tilted counts as open |
| type `PRESENCE` | occupancy sensor | `state` is `present` |
| type `ROOMMATE` or `GUEST` | occupancy sensor | `presence` is `present` |
| type `RESIDENTS` | security system | `home` disarmed, `gotosleep` night, `absent` stay, `gone` away; can be set from HomeKit |

### Added to any device

| Device has | Adds |
| --- | --- |
| reading `battery` | low battery, and the level if the reading is a number. See [battery](troubleshooting.md#the-battery-is-shown-as-low-although-it-is-fine). |
| reading `volume` or `Volume` | a volume from 0 to 100 the Eve app shows, set with `set volume` or `set Volume` |
| reading `power`, `energy`, `voltage`, `current` | the values the Eve app shows for a plug. `energy` in Wh is converted to kWh. |
| reading `firmware` or `D-firmware` | the firmware revision, if the reading holds a version number |
| reading `reachable` | while it is not `1`, reads from HomeKit are answered with an error and the accessory shows as not responding |

For SONOS the `Volume` reading is asked from FHEM on every read, as the module sends no events for
it. With `attr <device> generateVolumeEvent 1` it is followed like any other reading.

## HomeMatic IP and HomeMatic by way of HMCCU

Devices of the types `HMCCUCHN` and `HMCCUDEV` are mapped from their CCU datapoints instead of the
readings of CUL_HM, so HomeMatic IP devices are detected automatically:

| Type | Datapoints | Set command |
| --- | --- | --- |
| switch, outlet | `STATE` | `on` and `off`, else `datapoint <ch>.STATE` |
| dimmer | `LEVEL` | `pct`, else `datapoint <ch>.LEVEL` |
| blind, shutter | `LEVEL`, `LEVEL_2`, `ACTIVITY_STATE` or `DIRECTION` | `pct`, else `datapoint <ch>.LEVEL` |
| thermostat | `SET_POINT_TEMPERATURE`, `ACTUAL_TEMPERATURE`, `HUMIDITY`, `LEVEL`, `CONTROL_MODE` or `SET_POINT_MODE` | `desired-temp`, else `datapoint <ch>.SET_POINT_TEMPERATURE` |
| contact | `STATE` | read only |
| motion | `MOTION`, `ILLUMINATION` | read only |
| presence | `PRESENCE_DETECTION_STATE`, `ILLUMINATION` | read only |
| smoke | `SMOKE_DETECTOR_ALARM_STATUS` | read only |
| leak | `WATERLEVEL_DETECTED`, `MOISTURE_DETECTED` | read only |

`LOW_BAT` and the datapoints `POWER`, `CURRENT`, `VOLTAGE` and `ENERGY_COUNTER` are mapped as well.

- The reading names are looked up by datapoint, so any `ccureadingformat` works: `STATE`, `state`,
  `1.STATE` and `ABC1234567:1.STATE` are all recognised.
- On a HMCCUDEV with several channels that carry the same datapoint, select the one to use with
  `attr <device> controldatapoint <channel>.<datapoint>`.
- `LEVEL` is a datapoint from 0.0 to 1.0 and is scaled to 0 to 100 for HomeKit. If
  `attr <device> ccuscaleval` already scales it, that is detected and it is not scaled twice.
- Venetian blinds report the slat position as `LEVEL_2`. It is shown as a horizontal tilt angle
  from -90 (slats closed) to 90 (slats open). Use `homebridgeMapping` for blinds with vertical
  slats.
- The type is taken from the internal or attribute `ccurole`, then from `ccutype`, then from the
  datapoints that are there. Set `genericDeviceType` if the result is wrong. Besides the usual
  values, `motion`, `presence`, `smoke` and `leak` are understood for these devices.
- A bare `STATE` or `LEVEL` datapoint is only taken for an actuator if the device also has a
  command to set it, so sensors do not become switches.
- The target temperature of a thermostat ranges from 4.5 to 30.5 degrees in steps of 0.5. The
  modes auto and manual are offered when the device has the commands `auto` and `manu`.

At the usual log level every such device gets a line like
`Lamp (HmIP-BDT/DIMMER_VIRTUAL_RECEIVER) mapped as HMCCU light; LEVEL=1.LEVEL x100`.

## Names and identity

| HomeKit shows | Taken from |
| --- | --- |
| name | the `siriName` attribute, else `alias`, else the name of the device |
| manufacturer | `FHEM:<type of the device>` |
| model | the `model` reading, attribute or internal |
| serial number | what identifies the hardware where FHEM knows it (HomeMatic, ZWave, HUE, MAX, SONOS and others), else the `FUUID` of the device |

HomeKit recognises an accessory by its serial number. The one a device was first published with is
kept in `fhem2hb-identities.json` in the storage directory of Homebridge, so that the accessory
keeps its room and its automations. Manufacturer, model, serial number and firmware revision can be
set with a mapping, see [accessory information](mapping.md#accessory-information).

## Checking what was detected

1. **The log.** Every published device has a line at the usual log level:

   ```
   [FHEM] Lamp is light
   ```

   Other lines say why a device is missing: `ignoring <device>`, `no accessory created for
   <device> (<type>)`, `<device>: no service type detected`, `<device> is already published`.

2. **The debug log.** With the debug mode of Homebridge on (see
   [log level](configuration.md#log-level)) the plugin lists each device with its mappings:

   ```
   [FHEM] Lamp has
   [FHEM]   On [pct;on,off]
   [FHEM]   Brightness [pct]
   ```

   followed by the services and characteristics it creates, with their first values.

3. **The debug page.** `http://<homebridge>:8282/cached` shows every reading the plugin follows
   with its value in FHEM and in HomeKit. See [debug page](configuration.md#debug-page).

4. **In FHEM.** `list <devspec of the filter>` shows which devices the plugin is given, and
   `jsonlist2 <device>` what it sees of one: the readings, attributes and `PossibleSets` the
   tables above refer to.
