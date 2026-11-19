# homebridge-fhem2hb

a fhem platform plugin for homebridge.

this is the maintained successor of [homebridge-fhem](https://github.com/justme-1968/homebridge-fhem)
by justme1968 and its contributors. it is built on that code and keeps its configuration: the platform
is still called `FHEM`, and the `homebridgeMapping` and `genericDeviceType` attributes work as before.
it replaces homebridge-fhem and can not be installed next to it.

the project is under active restructuring and is not published yet.

uses longpoll and an internal cache to avoid roundtrips to fhem.

add one (or more) FHEM platforms to config.json and set the filter(s) to a fhem devspec that
includes the devices that should be bridged to homekit.

## platform config
```
{ "platform": "FHEM", "name": "FHEM", "server": "127.0.0.1", "port": 8083, "filter": "room=HomeKit" }
```
- server: host name or address of fhem
- port: the port of FHEMWEB, 8083 if not given
- filter: the fhem devspec of the devices to bridge. all devices if not given
- ssl: true to talk https to FHEMWEB
- rejectUnauthorized: with ssl, whether fhem has to show a certificate that is trusted. true: always.
  false: never, e.g. for the self-signed certificate of a fhem with `attr WEB HTTPS 1`.
  if not given, it is as it was in homebridge-fhem: **with auth the certificate is not checked**,
  without auth it is. without the check the connection is encrypted, but anybody in the network
  can pose as fhem and is sent user and password. set it to true if fhem has a certificate that
  node trusts
- webname: the webname of the FHEMWEB instance, fhem if not given
- auth: user and password of FHEMWEB: `{ "user": "...", "pass": "..." }`
- jsFunctions: a file with functions for reading2homekit and homekit2reading, see below
- neverTimeout: true to keep trying for ever when fhem can not be reached while homebridge starts
- allowInlineFunctions: false to refuse JavaScript in mappings, see [who is trusted](#who-is-trusted).
  it is allowed if not given
- debugPort: the port of the debug browser, which shows the cached readings and the subscriptions
  of all FHEM platforms. 8282 if not given, or 8283 when that is taken. false or 0 switches the
  debug browser off
- debugHost: the address the debug browser listens on. all addresses of the machine if not given,
  so that **anybody who reaches the port can read the names and readings of the devices**. set it
  to `127.0.0.1` to reach it from the machine homebridge runs on only

## who is trusted
the plugin does what fhem tells it to. two things reach further than the devices themselves:

- a homebridgeMapping can carry JavaScript: `reading2homekit` and `homekit2reading` take the body of a
  function between braces, e.g. `reading2homekit={return+orig*2}`, and the plugin runs it inside
  homebridge with the rights homebridge has. **whoever can set attributes in fhem can therefore run
  code on the machine homebridge runs on.** if fhem is not as protected as homebridge, or you do not
  use this, set `"allowInlineFunctions": false` for the platform. mappings with such a function then
  lose it, with a line in the log, and everything else goes on working. functions from the
  jsFunctions file are not affected: that file lies on the homebridge machine.
- the jsFunctions file is loaded as code. keep it where only the homebridge user can write.

## directly (automatically) supports:
- switches (devices with set on and set off commands)
- lights (devices with set on and set off commands)
- homematc, FS20 and ZWave dimmers (devices with set on, set off and set dim or set pct commands)
- HUE, WifiLight, MilightDevice, SWAP_0000002200000003 (hue, sat, bri, rgb)
- homematic, max, pid20 and comet dect  thermostats
- homematic, DUOFERN, SOMFY and FS20/IT(?) blinds
- hommatic, MAX and FHTTK contact sensors (door, window)
- HM-SEC-WIN, HM-SEC-KEY
- HM-Sen-LI-O
- presence, ROOMMATE, GUEST
- SONOS (power, volume)
- harmony scenes
- temperature and humidity sensors
- CO20 and netatmo air quality sensor
- RESIDENTS module
- HomeMatic and HomeMatic IP by way of HMCCU (see below)
- probably some more ...

## homematic ip (HMCCU)
HMCCUCHN and HMCCUDEV devices are mapped from their ccu datapoints instead of the CUL_HM
readings, so homematic ip switches, dimmers, blinds and thermostats are detected automatically:

| type | datapoints | set command |
| --- | --- | --- |
| switch, outlet | `STATE` | `on`/`off`, else `datapoint <ch>.STATE` |
| dimmer | `LEVEL` | `pct`, else `datapoint <ch>.LEVEL` |
| blind, shutter | `LEVEL`, `LEVEL_2`, `ACTIVITY_STATE` | `pct`, else `datapoint <ch>.LEVEL` |
| thermostat | `SET_POINT_TEMPERATURE`, `ACTUAL_TEMPERATURE`, `HUMIDITY`, `LEVEL` | `desired-temp`, else `datapoint <ch>.SET_POINT_TEMPERATURE` |
| contact | `STATE` | read only |
| motion | `MOTION`, `ILLUMINATION` | read only |
| presence | `PRESENCE_DETECTION_STATE`, `ILLUMINATION` | read only |
| smoke | `SMOKE_DETECTOR_ALARM_STATUS` | read only |
| leak | `WATERLEVEL_DETECTED`, `MOISTURE_DETECTED` | read only |

`LOW_BAT` and the `POWER`/`CURRENT`/`VOLTAGE`/`ENERGY_COUNTER` datapoints are mapped as well.

notes:
- the reading names are looked up by datapoint, so any `ccureadingformat` works
  (`STATE`, `state`, `1.STATE` and `ABC1234567:1.STATE` are all recognized).
- on a HMCCUDEV with several channels carrying the same datapoint use
  `attr <dev> controldatapoint <channel>.<datapoint>` to select the one to use.
- `LEVEL` is a 0.0-1.0 datapoint and is scaled to 0-100 for homekit. if
  `attr <dev> ccuscaleval` already scales it, that is detected and no second scaling is applied.
- venetian blinds expose the slat position as `LEVEL_2`, mapped to a horizontal tilt angle of
  -90 (slats closed) to 90 (slats open). use the homebridgeMapping attribute for blinds with
  vertical slats.
- the device type is taken from `ccurole`, then from `ccutype`, then from the datapoints that
  are present. use the genericDeviceType attribute if the result is wrong.
- a bare `STATE` or `LEVEL` datapoint is only treated as an actuator if the device also offers
  a way to set it, so sensors are not turned into switches.


## simple config
for devices that are not correctly identified use the genericDeviceType attribute to configure the device type.
supported values are: security,ignore,switch,outlet,light,blind,thermometer,thermostat,contact,garage,window,lock
this is probably mostly used for differentiating between switches and lights.

## enhanced config
for devices that don't use the autodetected readings and commands or for devices that mix readings from different
devices use the homebridgeMapping attribute. it is parsed from left to right and works as follows:
- the genericDeviceType attribute is used to determine the service type that should be used for this device
  in addition to the symbolic names above all homekit Service names are recognized
- the homebridgeMapping attribute containts a space separated list of characteristic descriptions
- each description consists of the characteristic name followed by a = followed by a komma separated list of parameters
- each parameter can be of the form
  - \<command\>:\<device\>:\<reading\> where parts can be omitted from left to right or
  - \<name\>=\<value\>
  - the name of an already mapped characteristic to copy the configuration from there
  - the special clear to clear the mappings for the current characteristic
  - linkedTo=\<service-name\> to link the current service to \<service-name\>
- characteristic names can be given as \<service_name\>#\<characteristic_name\> to create multiple services for a device
  this can also include a subtype like so: \<service_name\>(\<subtype\>)#\<characteristic_name\> to create multiple services of the same type
- the following special values for a description are recognized: clear -> clears all mappings for this device
e.g:
```
attr <thermostat> genericDeviceType thermostat
attr <thermostat> homebridgeMapping TargetTemperature=target::target,minValue=18,maxValue=25,minStep=0.5 CurrentTemperature=myTemp:temperature
```

this would define a thermostat device with a command target to set the desired temperature, a reading target that indicates the desired target temperature, the desired min, max and step values and a current temeprature comming from the temperature reading of the device myTemp.

the names for the stadard service and characteristic types can be found here: .../hap-nodejs/lib/gen/HomeKitTypes.js


### Currently supported values for Characteristic names are:
- On
- Brightness
- Hue
- Saturation
- CurrentTemperaure
- TargetTemperature
- CurrentRelativeHumidity
- CurrentAmbientLightLevel
- AirQuality
- CurrentDoorState
- OccupancyDetected
- StatusLowBattery
- SecuritySystemCurrentState
- SecuritySystemTargetState
- FirmwareRevision
- and all other homebridge Characteristic names

### FHEM -> Homekit parameters:
- minValue, maxValue, minStep: for all int and float characteristics -> the allowed range for this value in homekit
- max: Hue and Saturation characteristics -> the range the reading has in fhem, only if different from minValue and maxValue
- nocache: don't cache values for this reading
- subtype: unique value necessary if multiple characteristics of the same type are in an accessory.
- factor: multiply reading with this value
- threshold: reading is mapped to true if the value is greater than the threshold value and to false otherwise
- invert: invert the reading, taking minValue, maxValue into account
- part: the reading value will be splitted at spaces and the n-th item is used as the value. counting starts at 0
- values: a ; separated list that indicates the mapping of reading values to homekit values.
          each list entry consists of a : separated pair of from and to values
          each from value can be a literal value or a regex of the form /regex/
          each to value can be a literal value or a homekit defined term for this characteristic
          if to is exactly # then it is set to the current value. usefull for regex ranges
- valueOn, valueOff: the reading values that are mapped to the true/false resp. on/off states in homekit. shotcut for values
                     if only one is given all values not matching this one are automatically mapped to the other
- default: value to use if no reading is found or if none of values/valueOn/valueOff matches
- timeout: timeout in ms after which the homebridge value is reset to the default value -> used to simulate push buttons
- valid: a ; separated list of valid values for this characteristic,
         each to value can be a literal value or a homekit defined term for this characteristic
- readOnly: if set to true: make this charateristic read only. ignore any changes made by homekit

e.g.:
```
PositionState=motor,values=/^up/:INCREASING;/^down/:DECREASING;/.*/:STOPPED On=state,valueOn=/on|dim/,valueOff=off
```

the order of the transformations is as follows: eventMap, part, threshold, values, valueOn/valueOff, factor, max, maxValue/minValue/minStep, invert

instead of using the transformation chain reading2homekit can be set to the name of a js function that is imported from a file
named by the jsFunctions config option. relative paths are relative to the same path the config file is located in.
the function it will be called with mapping and reading value as parameters and has to return the value to be used with homekit.

for custom characterisitcs the additional parameters name, format and unit have to be set. e.g.:
```
00000027-0000-1000-8000-0026BB765291=Volume::Volume,name=Volume,format=UINT8,unit=PERCENTAGE,minValue=0,maxValue=0,minStep=1
```

adding a history characteristic will try to use fakegato-history to create Eve compatible history entries for ContactSensor and TemperatureSensor services:
```
history:size=1024
```

### Homekit -> FHEM parameters:

- delay: true/\<number\> -> the value ist send afer one second/\<number\>ms of inactivity
- factor: divide homekit value by this factor
- maxValue: for all int and float characteristics -> the allowed range for this value in homekit
- max: the max value the reading has in fhem, only if different from maxValue
- cmd: the set command to use: set \<device\> \<cmd\> \<value\>
- cmdOn, cmdOff: for all bool characteristics
- cmds: a ; separated list that indicates the mapping of homekit values to fhem values.  
    each list entry consists of a : separated pair of from and to values  
    each from value can be a literal value or a homekit defined term for this characteristic or a regex of the form /regex/  
    each to value has to be a literal value
- cmdSuffix: is appended to the set command

spaces in commands have to be replaced by +

e.g.:
```
TargetHeatingCoolingState=...,cmds=OFF:desired-temp+off;HEAT:controlMode+day;COOL:controlMode+night;AUTO:controlMode+auto
```

the order of the transformations is as follows: invert, factor, max/maxValue
precedence for mapping of homekit value to commands is in increasing order: cmd, cmdOn/cmdOff, cmds

instead of using the transformation chain homekit2reading can be set to the name of a js function that is imported from a file
named by the jsFunctions config option. relative paths are relative to the same path the config file is located in.
the function it will be called with mapping and the homekit value as parameters and has to return the value to be used with the fhem set command.

a dummy with a setList of exactly two entries will be mapped to a On characteristic where the first entry will be mapped to on and the second to off.


examples:
- 1 device -> 1 service (thermometer)
```
  attr <temp> genericDeviceType thermometer
  attr <temp> homebridgeMapping CurrentTemperature=temperature1,minValue=-30
```
  wenn das reading temperature heisst statt temperature1 muss es nicht angegeben werden.

- 1 device -> 1 service, 2 characteristics (thermostat)
```
  attr <thermostat> genericDeviceType thermostat
  attr <thermostat> homebridgeMapping TargetTemperature=target::target,minValue=18,maxValue=25,minStep=0.5
                                      CurrentTemperature=myTemp:temperature
```

- n devices -> 1 service, n characteristics (temp + hum, dummy thermostat + temp)
```
  attr <tempHum> genericDeviceType thermometer
  attr <tempHum> homebridgeMapping [CurrentTemperature=temperature1] CurrentRelativeHumidity=<device2>:humidity
```
  wenn das reading temperature heisst statt temperature1 kann CurrentTemperature=temperature1 entfallen

- 1 device -> 2 services, 1 identical characteristics each (thermometer)
```
  attr <dualTemp> genericDeviceType thermometer
  attr <dualTemp> homebridgeMapping CurrentTemperature=temperature1,minValue=-30,subtype=innen
                                    CurrentTemperature=temperature2,minValue=-30,subtype=aussen
```

- 1 device  -> n service with 1 identical characteristic each (1 service per harmony activity)
```
  attr <hub> genericDeviceType switch
  attr <hub> homebridgeMapping clear
                               On=activity,subtype=TV,valueOn=TV,cmdOn=activity+TV,cmdOff=off
                               On=activity,subtype=DVD,valueOn=/DVD/,cmdOn=activity+DVD,cmdOff=off
                               On=activity,subtype=Off,valueOn=PowerOff,valueOff=PowerOff,cmd=off
```

- 1 device -> n services: give characteristic names as \<service_name\>#\<characteristic_name\>
```
  attr <name> genericDeviceType switch
  attr <name> homebridgeMapping On=state,cmdOn=on,cmdOff=off
                                BatteryService#BatteryLevel=battery
                                BatteryService#StatusLowBattery=battery,threshold=20,values=0:BATTERY_LEVEL_LOW;;1:BATTERY_LEVEL_NORMAL
                                BatteryService#ChargingState=charging
```
  `BatteryService` is what the `Battery` service was called before. both names work, as do the other
  service and characteristic names HAP-NodeJS has renamed since.


instead of the format described above homebridgeMapping can also contain the same data encoded as json
this has to be used if any of the separators above are used in an command or value. at the moment the
json version replaces all build in defaults for a device. e.g.:
```
{ "PositionState": { "reading": "motor", "values": [...] }, "On": { "reading": "state", "valueOn": "/on|dim/", "valueOff": "off" } }
```

## troubleshooting

### the log is too long, or says too little

At the usual log level the plugin writes one line per device when homebridge starts, what HomeKit
writes to a device, and warnings and errors. Reads, the events of fhem, the mappings of each
device and the urls that are asked are logged for debugging only. To see them start homebridge with
`-D`, or switch on the debug mode in the settings of the homebridge UI (for a child bridge: in the
settings of that bridge). There is no option of the plugin for this, the log level is the one of
homebridge.

### a value in HomeKit is not the one in fhem

The plugin follows the events fhem sends. Check with the event monitor of fhem that the reading
does create an event when it changes: a reading that is set without one, as some older modules
do, is not seen. A read from
HomeKit is answered with the last value at once, and fhem is asked for the reading in the
background at most once a minute, so a missed event corrects itself when the Home app is opened
again. `nocache=1` on a mapping asks fhem on every read instead and makes reads slower; it is only
meant for readings that never create events.

When nothing arrives from fhem for a quarter of an hour the plugin checks the connection and
opens it again if needed. This shows in the log as `longpoll: nothing arrived for 15 minutes ...`.

### fhem runs in docker, or on another machine

`server` is the address homebridge reaches fhem under. With homebridge in one container and fhem in
another, `127.0.0.1` is the homebridge container itself: use the name of the fhem container or the
address of the host. FHEMWEB also has to accept connections from the address homebridge comes
from. With `ssl` and without `auth` the certificate of fhem is checked, so one that fhem made
itself needs `"rejectUnauthorized": false`; see the platform config above.

### homebridge starts before fhem

When fhem can not be reached the plugin tries again four times with a growing pause and then gives
up, and homebridge goes on without the devices of fhem. `"neverTimeout": true` makes it keep
trying. homebridge waits for the plugin in both cases, so on a machine that starts both, start fhem
first.

### blinds

A device is a blind with `genericDeviceType blind`. DUOFERN and SOMFY devices with a `position`
command are blinds without it. The position is read from `position` and set with `set position`
(`set pos` for SOMFY), or from and with `pct` for other devices. HomeKit counts how far a blind is
open, 100 is open. If your device counts the other way round, add `invert`:
```
  attr <blind> genericDeviceType blind
  attr <blind> homebridgeMapping CurrentPosition=position,invert TargetPosition=position,cmd=position,invert
```
A blind with a `stop` command can be stopped from HomeKit. For a blind that only knows `up`, `down`
and a few fixed positions, name the commands:
```
  attr <blind> homebridgeMapping TargetPosition=state,cmds=0:down;;50:go-my;;100:up
```
(`;;` is how a `;` is written in a fhem command; in the attribute itself it is a single `;`.)

### a thermostat offers modes it does not have

Without a mapping for `TargetHeatingCoolingState` a thermostat is shown as heating only. With one,
HomeKit offers the modes the mapping has commands for. `valid` says it directly:
```
  attr <thermostat> homebridgeMapping TargetHeatingCoolingState=mode,values=off:OFF;;manual:HEAT,cmds=OFF:mode+off;;HEAT:mode+manual,valid=OFF;;HEAT
```
The names of the modes are `OFF`, `HEAT`, `COOL` and `AUTO`; the numbers 0 to 3 work as well.

### the battery is shown as low although it is fine

A `battery` reading of `ok` is a good battery, any other text a low one, and a number is taken
for the level in percent, low up to 20. Some devices report `1` for a good battery and `0` for an
empty one, which then reads as 1 or 0 percent. Drop the level and say what the two values mean:
```
  attr <device> homebridgeMapping BatteryLevel=clear StatusLowBattery=clear
                                  StatusLowBattery=battery,values=0:BATTERY_LEVEL_LOW;;1:BATTERY_LEVEL_NORMAL
```

### a device is new in HomeKit after a restart and has lost its room

HomeKit recognises an accessory by a serial number the plugin works out from the device. The one a
device was first published with is kept in `fhem2hb-identities.json` in the storage directory of
homebridge and used from then on. Deleting that file makes the plugin work the identities out anew.
To give a device a fixed identity yourself use `SerialNumber=serial=<text>` in its homebridgeMapping.

### homebridge can not be added to HomeKit, or everything shows "no response"

A HomeKit bridge takes 149 accessories. The plugin warns in the log when a platform publishes more.
Use `filter` to publish fewer devices, or define several FHEM platforms with different filters and
run each as a child bridge.

One device with a mapping the plugin can not use no longer stops the others: it is left out and
named in the log with the error.
