# The homebridgeMapping attribute

A mapping connects one HomeKit characteristic, like `On` or `CurrentTemperature`, to a reading and
a set command of a FHEM device. The plugin creates mappings for the devices
[it recognises](devices.md). The `homebridgeMapping` attribute changes them or adds more: for
readings with other names, values that have to be translated, commands of your own, or several
services on one device.

- [Quick example](#quick-example)
- [Syntax](#syntax)
- [Parameters: FHEM to HomeKit](#parameters-fhem-to-homekit)
- [Parameters: HomeKit to FHEM](#parameters-homekit-to-fhem)
- [Functions](#functions)
- [Several services on one device](#several-services-on-one-device)
- [Custom characteristics](#custom-characteristics)
- [Accessory information](#accessory-information)
- [The JSON form](#the-json-form)
- [Recipes](#recipes)

The plugin adds the attribute to FHEM the first time it connects. It is read when Homebridge
starts: **restart Homebridge after changing it.**

The examples are `attr` commands for the command field of FHEM. There a `;` has to be written as
`;;`. In the attribute itself, as `list` shows it and as the tables below give it, it is a single
`;`.

## Quick example

```
attr Heating genericDeviceType thermostat
attr Heating homebridgeMapping TargetTemperature=target::target,minValue=18,maxValue=25,minStep=0.5 CurrentTemperature=RoomSensor:temperature
```

This is a thermostat whose target temperature is read from the reading `target` and set with
`set Heating target <value>`, from 18 to 25 degrees in steps of 0.5. The current temperature comes
from the reading `temperature` of another device, `RoomSensor`.

## Syntax

The attribute is a list of entries, separated by blanks or line breaks. Each entry describes one
characteristic:

```
<Characteristic>=<parameter>,<parameter>,...
```

`<Characteristic>` is the name of a HomeKit characteristic as HAP-NodeJS writes it: `On`,
`Brightness`, `CurrentTemperature`, `ContactSensorState` and so on. The names of all services,
characteristics and their values are in the
[definitions of HAP-NodeJS](https://github.com/homebridge/HAP-NodeJS/tree/latest/src/lib/definitions).

A parameter is one of:

| Parameter | Meaning |
| --- | --- |
| `<reading>` | the reading the value comes from |
| `<device>:<reading>` | the reading of another device |
| `<cmd>:<device>:<reading>` | also the set command the value is sent with. Parts can be left empty: `target::target` is the command `target` and the reading `target` of the device itself. |
| `<name>=<value>` | one of the named parameters of the tables below |
| `invert` | the same as `invert=true` |
| `<Characteristic>` | the name of a characteristic that already has a mapping: its mapping is copied |
| `clear` | forgets the mapping of this characteristic. Alone, as in `Brightness=clear`, it removes the characteristic. |

Entries that are special:

| Entry | Meaning |
| --- | --- |
| `clear` | forgets all mappings of the device, also the detected ones. Put it first. |
| `#...` | an entry that starts with `#` is skipped |
| `linkedTo=<Service>` | see [several services](#several-services-on-one-device) |
| `history=...` | see [history](history.md) |
| `AccessoryCategory=...`, `SerialNumber=...`, `Manufacturer=...`, `Model=...`, `FirmwareRevision=...` | see [accessory information](#accessory-information) |

How entries and detected mappings go together:

- The first entry for a characteristic changes the mapping the detection made for it: only the
  parameters you name are replaced. `TargetPosition=invert` keeps the detected reading and command.
- A second entry for the same characteristic adds another mapping. It needs a `subtype`, see
  [several services](#several-services-on-one-device).
- A mapping without a reading uses the reading `state`, unless it has a `default`.

What the text form can not say:

- A value can not contain a blank, a comma or a `=`. Write a blank as `+`: `cmdOn=activity+TV`
  sends `set <device> activity TV`.
- The lists of `values`, `cmds` and `valid` are separated by `;` and their pairs by `:`, so a value
  in them can not contain these either.
- Use [the JSON form](#the-json-form) for values with such characters.

An entry the plugin can not read is reported in the log with `wrong syntax:` and skipped.

## Parameters: FHEM to HomeKit

| Parameter | Meaning |
| --- | --- |
| `values` | translates reading values: a `;` separated list of `<from>:<to>` pairs. `<from>` is a literal value or a regular expression as `/regex/`. `<to>` is a literal value or the name HomeKit gives a value of this characteristic, like `CONTACT_DETECTED`. For a regular expression, `#` as `<to>` stands for the reading value itself. |
| `valueOn`, `valueOff` | for on/off characteristics: the reading value that means on, or off. A literal value or `/regex/`. If only one is given, every other value means the opposite. |
| `threshold` | a reading above the threshold becomes 1, any other 0 |
| `part` | the reading is split at blanks and the part with this number is used, counted from 0 |
| `factor` | the reading is multiplied by this |
| `max` | the largest value of the reading in FHEM, if it differs from `maxValue`: the reading is scaled from `0..max` to `0..maxValue` |
| `minValue`, `maxValue`, `minStep` | the range and the step HomeKit is told for a number. The value is brought into the range and rounded to the step. |
| `invert` | inverts the value within `minValue` and `maxValue`, within 0 and 100 if they are not given, and on and off for an on/off characteristic |
| `default` | the value if the reading does not exist or none of the `values` matches. A literal value or the name of a HomeKit value. A mapping with only a `default` and no reading is a constant. |
| `valid` | a `;` separated list of the values HomeKit may offer for this characteristic, as numbers or HomeKit names |
| `timeout` | milliseconds after which the characteristic falls back to its `default` after HomeKit has set it. Makes a push button. |
| `nocache` | FHEM is asked on every read from HomeKit instead of answering with the last value. For readings that create no events. Slower. |
| `subtype` | tells several mappings of the same characteristic apart, see [several services](#several-services-on-one-device) |
| `reading2homekit` | a function that converts the reading instead of everything above, see [functions](#functions) |

Example:

```
attr Blind homebridgeMapping PositionState=motor,values=/^up/:INCREASING;;/^down/:DECREASING;;/.*/:STOPPED
attr Dimmer homebridgeMapping On=state,valueOn=/on|dim/,valueOff=off
```

The conversions are applied in this order:

1. `eventMap` of the device, for entries that map to `on` or `off`
2. `part`
3. `threshold`
4. `values`: the regular expressions in the order given, then literal values, which win
5. `valueOn` and `valueOff`. Without them, `on` is on, `off` is off and any other value is on if it
   is a number other than 0.
6. `factor`
7. `max`
8. `minValue`, `maxValue`, `minStep`
9. `invert`

Things to know:

- `nocache`, `invert` and `readOnly` are switched on by any value, also by `false` or `0`. Leave
  the parameter out to switch it off.
- A reading value that starts with `set-` or `set_` is ignored: the device has not confirmed the
  command yet.
- A value none of the `values` matches, with no `default`, is ignored and reported once in the log
  with `not handled in values`.
- **Readings with fixed handling.** For the readings `temperature`, `measured`, `measured-temp`,
  `desired-temp`, `desired` and `desiredTemperature` only `minValue`, `maxValue` and `minStep`
  apply; `on` reads as 31 and `off` as 4 degrees. The readings `humidity` and `onoff` are only
  read as whole numbers. To convert such a reading in another way, use `reading2homekit`.
- HomeKit refuses values outside the range or the format of a characteristic and then shows the
  whole accessory as not responding. The plugin brings every value into the range before it is
  handed on, and ignores one that can not be made to fit.

## Parameters: HomeKit to FHEM

| Parameter | Meaning |
| --- | --- |
| `cmd` | the set command: `set <device> <cmd> <value>` |
| `cmdOn`, `cmdOff` | the commands for on and off: `set <device> <cmdOn>` |
| `cmds` | translates values to commands: a `;` separated list of `<from>:<to>` pairs. `<from>` is a literal value, the name of a HomeKit value or `/regex/`. `<to>` is what follows `set <device>`. |
| `cmdSuffix` | appended to every command |
| `delay` | wait before sending and send only the last value, for sliders: `true` for one second, or milliseconds, at least 500 |
| `factor` | the value from HomeKit is divided by this |
| `max` | the value is scaled from `0..maxValue` to `0..max` |
| `invert` | as above |
| `readOnly` | HomeKit can not change the characteristic. Nothing is sent to FHEM. |
| `homekit2reading` | a function that converts the value instead of `invert`, `factor` and `max`, see [functions](#functions) |

Example:

```
attr Heating homebridgeMapping TargetHeatingCoolingState=mode,values=off:OFF;;manual:HEAT;;auto:AUTO,cmds=OFF:mode+off;;HEAT:mode+manual;;AUTO:mode+auto
```

A number from HomeKit is converted in the order `invert`, `factor`, `max`. The command is then the
first of these that applies:

1. `cmdOn` for the value 1 or true, `cmdOff` for 0 or false
2. the entry of `cmds` for the value
3. `<cmd> <value>`

Things to know:

- A device named in the mapping (`<device>:<reading>`) also receives the command.
- While a delayed command is waiting, like a new brightness, switching `On` is not sent as well:
  the waiting command switches the device on.
- Give a characteristic HomeKit can write a `cmd`, `cmdOn`/`cmdOff` or `cmds`, or make it
  `readOnly`.

## Functions

`reading2homekit` and `homekit2reading` replace the conversion with a JavaScript function. There
are two ways to give one:

**By name, from a file.** The function lives in the file the platform option
[`jsFunctions`](configuration.md#jsfunctions) names:

```
attr Lamp homebridgeMapping Brightness=level::level,reading2homekit=byteToPercent,homekit2reading=percentToByte
```

**Between braces, in the attribute.** The body of a function with the arguments `mapping` and
`orig`:

```
attr Lamp homebridgeMapping Brightness=level::level,reading2homekit={return+Math.round(orig/2.55)},homekit2reading={return+Math.round(orig*2.55)}
```

In the text form such a body can not contain a comma or a `=`, and every `+` becomes a blank. Use
[the JSON form](#the-json-form) or a file for anything longer than a formula. Code in attributes is
run inside Homebridge; see [who is trusted](configuration.md#who-is-trusted) and the option
`allowInlineFunctions`.

Both functions are called with the mapping and the value, and return the converted value:

| Function | Gets | Returns |
| --- | --- | --- |
| `reading2homekit` | the reading as text | the value for HomeKit. Without a value (`undefined`) the `default` of the mapping is used, or the characteristic keeps what it has. |
| `homekit2reading` | the value from HomeKit | what is appended to `cmd`. Without a value (`undefined`) nothing is sent. |

A function that fails is reported in the log and the value is ignored.

## Several services on one device

An accessory has one main service, the one `genericDeviceType` or the detection chose. A
characteristic name can carry the service it belongs to:

```
<Service>#<Characteristic>=...
<Service>(<subtype>)#<Characteristic>=...
```

```
attr Plug genericDeviceType switch
attr Plug homebridgeMapping On=state,cmdOn=on,cmdOff=off Battery#BatteryLevel=battery Battery#StatusLowBattery=battery,threshold=20,values=0:BATTERY_LEVEL_LOW;;1:BATTERY_LEVEL_NORMAL Battery#ChargingState=charging,values=yes:CHARGING;;no:NOT_CHARGING
```

- **Entries without a service belong to the service named last.** Put the entries for the main
  service first: an `On=...` after `Battery#BatteryLevel=...` would be looked for in the battery
  service.
- Two services of the same type need a subtype each, which is also shown as their name:
  `TemperatureSensor(inside)#CurrentTemperature=...`. For the main service use the parameter
  instead: `CurrentTemperature=temperature1,subtype=inside`.
- A mapping that needs a second service of a type without a subtype of its own is skipped, with a
  line in the log.
- The entry `linkedTo=<Service>` links the service of the entries before it to the named service,
  which has to be one without a subtype. HomeKit needs this for the inputs of a television, see the
  [recipe](#a-television-with-inputs).

Services and characteristics that HAP-NodeJS has renamed are still known by their old names, so
existing attributes keep working:

| Old name | Name today |
| --- | --- |
| `BatteryService` | `Battery` |
| `Slat` | `Slats` |
| `Label` | `ServiceLabel` |
| `Relay` | `CloudRelay` |
| `TunneledBTLEAccessoryService` | `Tunnel` |
| `CameraEventRecordingManagement` | `CameraRecordingManagement` |
| `LabelIndex` | `ServiceLabelIndex` |
| `LabelNamespace` | `ServiceLabelNamespace` |
| `PairingPairings` | `ListPairings` |
| `SelectedStreamConfiguration` | `SelectedRTPStreamConfiguration` |

## Custom characteristics

A characteristic HomeKit does not define is given by its uuid and needs a `name`. Apps like Eve
show the ones they know.

| Parameter | Meaning |
| --- | --- |
| `name` | the name of the characteristic. Required. |
| `format` | `BOOL`, `INT`, `FLOAT`, `STRING`, `UINT8`, `UINT16`, `UINT32` or `UINT64` |
| `unit` | `CELSIUS`, `PERCENTAGE`, `ARC_DEGREE`, `LUX`, `SECONDS`, or any other text |

```
attr Plug homebridgeMapping E863F10D-079E-48FF-8F27-9C2605A29F52=watt,name=Power,format=FLOAT,unit=W
```

HomeKit can write such a characteristic if its mapping has a `cmd`, `cmdOn`, `cmdOff` or `cmds` and
is not `readOnly`.

For these the plugin knows the uuid, so the name can be used in its place. `name` is still needed:

| Name | Is |
| --- | --- |
| `Voltage`, `Current`, `Power`, `Energy` | the measurements of a plug as the Eve app knows them |
| `AirPressure` | the air pressure as the Eve app knows it |
| `Actuation` | the valve position of a thermostat as the Eve app knows it |
| `CT` | the colour temperature as homebridge-hue defines it |
| `xVolume` | a volume characteristic of this plugin's own |

```
attr Meter homebridgeMapping Voltage=volt,name=Voltage,format=FLOAT
```

An entry whose name is neither a HomeKit characteristic nor has a `name` is left out without a
message.

## Accessory information

| Entry | Sets |
| --- | --- |
| `Manufacturer=value=<text>` | the manufacturer |
| `Model=value=<text>` | the model |
| `SerialNumber=serial=<text>` | the serial number, and with it the identity of the accessory in HomeKit |
| `FirmwareRevision=<reading>` | the firmware revision from a reading. HomeKit takes up to three numbers with dots; the first part of the reading that looks like that is used. |
| `AccessoryCategory=<NAME>` | the HomeKit category of the accessory: `FAN`, `LIGHTBULB`, `SWITCH`, `OUTLET`, `SENSOR`, `THERMOSTAT`, `WINDOW_COVERING`, `TELEVISION` or another category of HAP-NodeJS. The log has `using category:` or `unknown category:`. |

`Manufacturer` and `Model` can also name a reading instead of `value=`.

```
attr Fan homebridgeMapping AccessoryCategory=FAN SerialNumber=serial=ABC123 Manufacturer=value=ACME FirmwareRevision=fw
```

Changing the serial number of a device that is already in HomeKit makes it a new accessory there.

## The JSON form

Instead of entries the attribute can hold a JSON object. Use it when a value contains one of the
separators of the text form.

```
{
  "On": { "reading": "switch", "valueOn": "ein", "cmdOn": "ein", "cmdOff": "aus" },
  "Brightness": {
    "reading": "level",
    "cmd": "level",
    "delay": true,
    "reading2homekit": "{return Math.round(orig/2.55)}",
    "homekit2reading": "{return Math.round(orig*2.55)}"
  }
}
```

- **The JSON form replaces all detected mappings of the device.** Every characteristic has to be
  given in full.
- The keys are the characteristic names of the text form, with `<Service>#` and
  `<Service>(<subtype>)#` where needed. The properties are the parameters of the tables above.
- `reading`, `device` and `cmd` are properties of their own.
- `values`, `cmds` and `valid` are lists of text: `"values": ["off:OFF", "manual:HEAT"]`.
- Several mappings for one characteristic are a list of objects.
- The whole attribute has to be the object, from `{` to `}`. If it is not valid JSON, the log has
  `JSON.parse` with the reason and the detected mappings stay as they are.

Paste a JSON mapping into the attribute field of the device in FHEMWEB. In the command field of
FHEM every `;` in it has to be doubled.

## Recipes

### A reading with another name

```
attr Sensor genericDeviceType thermometer
attr Sensor homebridgeMapping CurrentTemperature=temperature1,minValue=-30
```

If the reading is called `temperature` no mapping is needed.

### Temperature and humidity from two devices

```
attr Sensor genericDeviceType thermometer
attr Sensor homebridgeMapping CurrentRelativeHumidity=OtherSensor:humidity
```

### A thermostat made of a dummy and a sensor

```
attr Heating genericDeviceType thermostat
attr Heating homebridgeMapping TargetTemperature=target::target,minValue=18,maxValue=25,minStep=0.5 CurrentTemperature=RoomSensor:temperature
```

### Two temperatures of one device as two sensors

```
attr Dual genericDeviceType thermometer
attr Dual homebridgeMapping CurrentTemperature=temperature1,minValue=-30,subtype=inside CurrentTemperature=temperature2,minValue=-30,subtype=outside
```

### One switch per activity of a harmony hub

The plugin does this by itself for a hub without `homebridgeMapping`. To choose the activities:

```
attr Hub genericDeviceType switch
attr Hub homebridgeMapping clear On=activity,subtype=TV,valueOn=TV,cmdOn=activity+TV,cmdOff=off On=activity,subtype=DVD,valueOn=/DVD/,cmdOn=activity+DVD,cmdOff=off On=activity,subtype=Off,valueOn=PowerOff,valueOff=PowerOff,cmd=off
```

### A push button

```
attr Gate genericDeviceType switch
attr Gate homebridgeMapping On=button,cmdOn=press,default=0,timeout=500
```

HomeKit shows the switch as off again half a second after it was pressed.

### A value out of a reading with several values

For a reading `measurement` of `T: 21.5 H: 60`:

```
attr Sensor genericDeviceType thermometer
attr Sensor homebridgeMapping CurrentTemperature=measurement,part=1 CurrentRelativeHumidity=measurement,part=3
```

### A number as on and off

```
attr Detector genericDeviceType MotionSensor
attr Detector homebridgeMapping MotionDetected=movement,threshold=100
```

### A remote control button

```
attr Remote genericDeviceType StatelessProgrammableSwitch
attr Remote homebridgeMapping ProgrammableSwitchEvent=button,values=short:SINGLE_PRESS;;long:LONG_PRESS
```

Every event of the reading is a press, also when the value is the same as before.

### A television with inputs

```
attr TV genericDeviceType Television
attr TV homebridgeMapping clear Television#Active=power,values=on:ACTIVE;;off:INACTIVE,cmds=ACTIVE:power+on;;INACTIVE:power+off ActiveIdentifier=input,values=hdmi1:1;;hdmi2:2,cmds=1:input+hdmi1;;2:input+hdmi2 InputSource(hdmi1)#Identifier=default=1 linkedTo=Television InputSource(hdmi2)#Identifier=default=2 linkedTo=Television
```

### Blinds, thermostat modes, battery

See the [troubleshooting](troubleshooting.md): [blinds](troubleshooting.md#blinds),
[thermostat modes](troubleshooting.md#a-thermostat-offers-modes-it-does-not-have),
[battery](troubleshooting.md#the-battery-is-shown-as-low-although-it-is-fine).
