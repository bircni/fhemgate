# Troubleshooting

- [The log is too long, or says too little](#the-log-is-too-long-or-says-too-little)
- [A device does not appear in HomeKit](#a-device-does-not-appear-in-homekit)
- [A change in FHEM does not show up](#a-change-in-fhem-does-not-show-up)
- [A value in HomeKit is not the one in FHEM](#a-value-in-homekit-is-not-the-one-in-fhem)
- [FHEM can not be reached](#fhem-can-not-be-reached)
- [Homebridge starts before FHEM](#homebridge-starts-before-fhem)
- [Blinds](#blinds)
- [A thermostat offers modes it does not have](#a-thermostat-offers-modes-it-does-not-have)
- [The battery is shown as low although it is fine](#the-battery-is-shown-as-low-although-it-is-fine)
- [A device is new in HomeKit after a restart and has lost its room](#a-device-is-new-in-homekit-after-a-restart-and-has-lost-its-room)
- [Homebridge can not be added to HomeKit, or everything shows "no response"](#homebridge-can-not-be-added-to-homekit-or-everything-shows-no-response)
- [Messages in the log](#messages-in-the-log)

## The log is too long, or says too little

At the usual log level the plugin writes one line per device when Homebridge starts, what HomeKit
writes to a device, and warnings and errors. Reads, the events of FHEM, the mappings of each device
and the addresses that are asked are logged for debugging only. To see them start Homebridge with
`-D`, or switch on the debug mode in the settings of the Homebridge UI (for a child bridge: in the
settings of that bridge). The plugin has no option for this, the log level is the one of
Homebridge.

## A device does not appear in HomeKit

1. Is it selected? Run `list <your filter>` in FHEM, for example `list room=HomeKit`. The device
   has to be in the result.
2. Was Homebridge restarted? Devices are read once, when Homebridge starts.
3. What does the log say about it? Look for the name of the device:

   | Log line | Meaning |
   | --- | --- |
   | `<device> is <type>` | the device is published |
   | `ignoring <device>` | it has `genericDeviceType ignore`, or is a `structure`, `SVG` or `THRESHOLD` without `genericDeviceType` |
   | `<device>: no service type detected` | the plugin does not know what it is. Set [`genericDeviceType`](devices.md#saying-what-a-device-is-genericdevicetype). |
   | `no accessory created for <device>` | as above, or with an error behind it: the mapping of the device can not be used |
   | `<device> is already published` | another FHEM server of this entry has published a device of this name |
   | `ignoring <device> for siri` | the platform has a [`scope`](configuration.md#scope) without `siri` |

A device with a mapping the plugin can not use does not stop the others: it is left out and named
in the log with the error.

## A change in FHEM does not show up

The attributes `genericDeviceType`, `homebridgeMapping`, `siriName` and `alias`, the set commands
of a device and the result of the filter are read when Homebridge starts. Restart Homebridge after
changing any of them.

## A value in HomeKit is not the one in FHEM

The plugin follows the events FHEM sends. Check with the event monitor of FHEM that the reading
does create an event when it changes: a reading that is set without one, as some older modules do,
is not seen, and neither is one that `event-on-change-reading` or a similar attribute holds back.

A read from HomeKit is answered with the last value at once, and FHEM is asked for the reading in
the background at most once a minute, so a missed event corrects itself when the Home app is opened
again. `nocache=1` on a [mapping](mapping.md) asks FHEM on every read instead and makes reads
slower; it is only meant for readings that never create events.

When nothing arrives from FHEM for a quarter of an hour the plugin checks the connection and opens
it again if needed. This shows in the log as `longpoll: nothing arrived for 15 minutes ...`.

The [debug page](configuration.md#debug-page) shows for every reading the value the plugin has
from FHEM and the value it gave HomeKit.

## FHEM can not be reached

`server` is the address Homebridge reaches FHEM under. With Homebridge in one container and FHEM in
another, `127.0.0.1` is the Homebridge container itself: use the name of the FHEM container or the
address of the host. FHEMWEB also has to accept connections from the address Homebridge comes from.

| Log line | Check |
| --- | --- |
| `longpoll error: ... ECONNREFUSED` | `server`, `port` and whether FHEMWEB listens on that address |
| `longpoll refused by fhem with 401 ...: authentication failed` | user and password in [`auth`](configuration.md#password). The plugin keeps trying, so a corrected password in FHEM is picked up. |
| `the certificate of fhem is not trusted` | with `ssl` and without `auth` the certificate of FHEM is checked. One that FHEM made itself needs `"rejectUnauthorized": false`, see [https](configuration.md#https). |
| `There was a problem connecting to FHEM` | a single command or read failed. The address is in the line. |

## Homebridge starts before FHEM, or FHEM is away

Homebridge keeps the accessories from one start to the next and publishes them without waiting for
FHEM. While FHEM can not be reached, HomeKit shows them as not responding, and a command from
HomeKit is answered with an error instead of being lost. The plugin tries again with a growing
pause, for as long as Homebridge runs, and builds the accessories from what FHEM lists once it is
back. Nothing is removed while FHEM is away.

On the very first start there are no accessories yet: they appear once FHEM answers.

## Blinds

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

(`;;` is how a `;` is written in a FHEM command. In the attribute itself it is a single `;`.)

## A thermostat offers modes it does not have

Without a mapping for `TargetHeatingCoolingState` a thermostat is shown as heating only. With one,
HomeKit offers the modes the mapping has commands for. `valid` says it directly:

```
attr <thermostat> homebridgeMapping TargetHeatingCoolingState=mode,values=off:OFF;;manual:HEAT,cmds=OFF:mode+off;;HEAT:mode+manual,valid=OFF;;HEAT
```

The names of the modes are `OFF`, `HEAT`, `COOL` and `AUTO`. The numbers 0 to 3 work as well.

## The battery is shown as low although it is fine

A `battery` reading of `ok` is a good battery, any other text a low one. A number is taken for the
level in percent, low up to 20. Some devices report `1` for a good battery and `0` for an empty
one, which then reads as 1 or 0 percent. Drop the level and say what the two values mean:

```
attr <device> homebridgeMapping BatteryLevel=clear StatusLowBattery=clear StatusLowBattery=battery,values=0:BATTERY_LEVEL_LOW;;1:BATTERY_LEVEL_NORMAL
```

## A device is new in HomeKit after a restart and has lost its room

HomeKit recognises an accessory by a serial number the plugin works out from the device. The one a
device was first published with is kept in `fhemgate-identities.json` in the storage directory of
Homebridge and used from then on. Deleting that file makes the plugin work the identities out anew.
To give a device a fixed identity yourself use `SerialNumber=serial=<text>` in its
`homebridgeMapping`.

## Homebridge can not be added to HomeKit, or everything shows "no response"

A HomeKit bridge takes 149 accessories. The plugin publishes no more, and says in the log which
devices it left out. Use `filter` to publish fewer devices, or define several fhemgate entries with
different filters and run each as a child bridge. See
[more than 149 accessories](configuration.md#more-than-149-accessories).

## Messages in the log

| Log line | Meaning |
| --- | --- |
| `config.json has a platform "FHEM", which no plugin serves` | An entry of homebridge-fhem. Change it as the line says, see [moving from homebridge-fhem](migration.md). |
| `<name> is no longer published by fhem. its accessory is removed if that is still so in 10 minutes.` | FHEM no longer lists the device, or lists it left out on purpose. Its accessory goes in ten minutes, unless the device is back by then. |
| `removing <name>, which fhem no longer publishes` | The accessory of the device was removed. |
| `<name> has the identity of an accessory that is published already, and is left out` | Two devices have the same serial number. Give one of them its own with `SerialNumber=serial=<text>` in its `homebridgeMapping`. |
| `no siri device found. please define it.` | The plugin looks for a device of the FHEM module `siri` and notes its version there. Nothing else depends on it. `define siri siri` in FHEM ends the message. |
| `genericDeviceType attribute was not known to fhem and was created. restart homebridge after giving it to devices.` | First start against this FHEM. Set the attribute where needed and restart Homebridge. |
| `homebridgeMapping attribute created.` | First start against this FHEM. Nothing to do. |
| `wrong syntax: ...` | An entry of a `homebridgeMapping` can not be read and is skipped. See the [syntax](mapping.md#syntax). |
| `... value ... not handled in values` | A reading has a value the `values` of its mapping do not cover. Add it, or a `default`. |
| `JavaScript in a mapping is refused, as allowInlineFunctions is false for this platform` | See [who is trusted](configuration.md#who-is-trusted). |
| `fakegato-history not installed` | See [history](history.md). |
| `fakegato-history failed to load, the plugin runs without the Eve history` | fakegato-history is installed but broken. Install it again, see [history](history.md). |
| `debug server on port ...: Error: listen EADDRINUSE` | The port of the [debug page](configuration.md#debug-page) is taken. Set another `debugPort`, or `false`. |
