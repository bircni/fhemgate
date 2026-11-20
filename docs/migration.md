# Moving from homebridge-fhem

This is for an installation that runs [homebridge-fhem](https://github.com/justme-1968/homebridge-fhem)
and moves to homebridge-fhem2hb. It is written against homebridge-fhem 0.5.54, the last version
on npm. If yours is older than 0.5.50, read [Coming from an older version](#coming-from-an-older-version)
first.

homebridge-fhem2hb replaces homebridge-fhem. It reads the same platform entry in `config.json`
and the same `homebridgeMapping` and `genericDeviceType` attributes in fhem. Done in the order
below, HomeKit keeps your accessories with their rooms, names, scenes and automations.

## What HomeKit keeps, and why

HomeKit knows a bridged accessory by an id that homebridge hands out and keeps in
`persist/IdentifierCache.<bridge>.json` in its storage directory. homebridge finds that id again
by the uuid of the accessory, which it makes from two things: the `platform` value of the config
entry, and the serial number the plugin works out for the device (or its name, if it has none).

Both are the same as in homebridge-fhem:

- the platform is still called `FHEM`,
- name, serial number and uuid of an accessory are worked out the same way for every device type.

The tests of this plugin check that for every device fixture against what homebridge-fhem 0.5.54
did, and start a real homebridge on a storage directory as homebridge-fhem left it. This was not
tried against a real HomeKit home, so keep the backup until you have looked at yours.

HomeKit forgets accessories when homebridge publishes the bridge without them. During a
migration that happens in three ways, and the steps below avoid all of them:

1. homebridge starts while neither plugin is installed. It skips the `FHEM` entry and publishes
   the bridge without the fhem accessories.
2. homebridge starts while both plugins are installed. Both register the platform `FHEM`,
   homebridge loads it from neither and publishes the bridge without the fhem accessories. Its
   log says `The requested platform 'FHEM' has been registered multiple times`, and
   homebridge-fhem2hb prints a warning that starts with
   `homebridge-fhem2hb: homebridge-fhem is installed as well`.
3. fhem can not be reached when homebridge starts. Like homebridge-fhem, the plugin gives up
   after the fourth failed attempt, about 20 seconds, and hands homebridge an empty list, unless
   the platform entry has `"neverTimeout": true`.

So: stop homebridge first, change the plugins while it is stopped, and start it once, with fhem
running.

## Before you start

1. Check the versions. homebridge-fhem2hb needs Node 22.12 or later, 24 or 26, and homebridge
   1.8 or later, or 2.x.

   ```sh
   node --version
   homebridge --version
   ```

   If Node or homebridge has to be updated, do that on its own before this migration, so that
   only one thing changes at a time. homebridge-fhem 0.5.54 declares that it runs with
   homebridge 2.

2. Find the storage directory of homebridge. It is the directory that holds `config.json`,
   `~/.homebridge` unless homebridge is started with `-U <directory>`.

3. Find out how homebridge-fhem is installed, and which version.

   ```sh
   npm ls -g homebridge-fhem
   ```

   This lists it if it is installed globally, which is what `npm install -g homebridge-fhem`
   does. If it is not listed, your homebridge keeps its plugins in a directory of its own (the
   `-P` option of homebridge, or what your installer set up). The new plugin has to go into the
   same `node_modules` directory as the old one: that is where homebridge looks, and only there
   can the new plugin see that the old one is still installed.

4. Look at the `platform` value of your FHEM entry in `config.json`. It is `"FHEM"`, or, less
   common, `"homebridge-fhem.FHEM"`. **Do not change it**, whichever it is: the uuid of every
   accessory is made from that text. homebridge-fhem2hb answers to both.

   An entry with `_bridge` settings, a child bridge, stays as it is as well.

5. Stop homebridge, and make sure nothing starts it again before the last step: a service
   manager that restarts it, or a user interface that restarts it after a plugin was installed
   or removed.

6. Back up the storage directory. For the default directory:

   ```sh
   cp -a ~/.homebridge ~/.homebridge.before-fhem2hb
   ```

   The backup holds what is needed to go back: `config.json`, `persist/` (the pairing and the
   ids of the accessories), `accessories/`, and the Eve histories in `*_persist.json`.

7. Make sure fhem is running, and do not restart it between the last start with homebridge-fhem
   and the first start with homebridge-fhem2hb. This matters for `HUEDevice` devices: their
   accessory is identified by the `uniqueid` internal once the hue bridge has reported it, and by
   the `FUUID` before. homebridge-fhem worked that out anew on every start. homebridge-fhem2hb
   writes down what it finds on its first start and keeps it from then on. In fhem,

   ```
   list TYPE=HUEDevice uniqueid
   ```

   should show the `uniqueid` of your lamps, and none of them as `ff:ff:ff:ff:ff:ff:ff:ff-0b`.
   A device that never has one is identified by its `FUUID` either way.

## Steps

1. With homebridge stopped, install homebridge-fhem2hb from npm the way homebridge-fhem was
   installed. For a global installation:

   ```sh
   npm install -g homebridge-fhem2hb
   ```

   Use `sudo` if you needed it to install homebridge-fhem. If your plugins are in a directory of
   their own, use the command you installed homebridge-fhem with, with `homebridge-fhem2hb` in
   place of `homebridge-fhem`.

   Do not install it from the plugins page of the Homebridge UI while homebridge-fhem is still
   installed: the UI may restart homebridge with both plugins, which is case 2 above.

2. Still with homebridge stopped, uninstall homebridge-fhem from the same place.

   ```sh
   npm uninstall -g homebridge-fhem
   ```

   Install first and uninstall second, so that there is no moment in which a start of homebridge
   would find neither plugin.

3. Leave the FHEM entry of `config.json` as it is. One addition is recommended: `neverTimeout`,
   so that a fhem that is not reachable at the start makes homebridge wait instead of publishing
   the bridge without the fhem accessories.

   ```json
   {
     "platform": "FHEM",
     "name": "FHEM",
     "server": "127.0.0.1",
     "port": 8083,
     "filter": "room=HomeKit",
     "neverTimeout": true
   }
   ```

   With `neverTimeout`, homebridge does not finish starting, for all its plugins, until fhem
   answers. Without it, see case 3 above.

   If your `auth` has keys other than `user` and `pass` (or `username` and `password`), see
   [Configuration](#configuration).

4. Start homebridge.

## Check afterwards

In the log of homebridge:

- `this is homebridge-fhem2hb <version>` shows that the new plugin was loaded.
- `Plugin 'homebridge-fhem2hb' tried to register with an incorrect plugin identifier:
  'homebridge-fhem'` is expected and needs no report. The plugin registers its platform under the
  name of homebridge-fhem on purpose, so that an entry with `"platform": "homebridge-fhem.FHEM"`
  keeps working.
- `Fetching FHEM devices...` and `got: <n> results` show that fhem answered, with the number of
  devices you expect. The plugin logs one line per device, like `lamp is switch`. The details it
  used to log are only shown when homebridge runs with debug logging (`-D`).
- There is no line that starts with `homebridge-fhem2hb: homebridge-fhem is installed as well`,
  and none with `has been registered multiple times` or `No plugin was found for the platform`.
- Lines of the plugin with `config:` in them name a key of your entry that needs attention.

In the storage directory, there is a new file `fhem2hb-identities.json`. It lists what every
device was published as, by its `FUUID`. Keep it: with it a device stays the same accessory when
what fhem reports about it changes.

In the Home app, the accessories are in their rooms under their names, and a scene or automation
that uses one of them still works. If accessories show up as new in the default room, stop
homebridge and go back as described below before you change anything in the Home app.

In Eve, the history of a device with a `history` mapping goes on where it was. The files
`<host>_<FUUID>_persist.json` in the storage directory are the same ones homebridge-fhem wrote.

## What changed

### Needs action

| What | Before | Now | What to do |
|---|---|---|---|
| Node and homebridge | any | Node 22.12+, 24 or 26, homebridge 1.8+ or 2.x | update first |
| Both plugins installed | | homebridge loads the `FHEM` platform from neither | uninstall homebridge-fhem while homebridge is stopped |
| Digest authentication | used when FHEMWEB or a proxy asked for it | not possible | set FHEMWEB or the proxy to basic authentication |
| `auth.sendImmediately` | `false` unless given: user and password were sent after FHEMWEB asked | not used: user and password are sent with every request, as basic authentication | remove the key. The plugin logs a line for it |
| `auth.bearer` | sent as a bearer token | not sent | no replacement. The plugin logs a warning |

Since user and password go out with the first request, use `"ssl": true` if the connection to
fhem leaves the machine. With `ssl` and `auth`, the certificate of fhem is not checked unless
`"rejectUnauthorized": true` is set, as it was in homebridge-fhem.

### Changes what you see in HomeKit

These devices are the same accessory as before, but with another service or other
characteristics. When the service type of an accessory changes, expect HomeKit to treat that
service as new: the tile can lose a name you gave it, and scenes and automations can lose their
action for it. To keep such a device as it was, set the attribute in fhem **before** the first
start with the new plugin.

| Device | Before | Now | To keep the old behaviour |
|---|---|---|---|
| a blind that is set with `set pct`, e.g. a CUL_HM blindActuator | Lightbulb with the characteristics of a blind | WindowCovering | `attr <device> genericDeviceType light` |
| DUOFERN and SOMFY devices with a position command and no `genericDeviceType` | Switch | WindowCovering | `attr <device> genericDeviceType switch` |
| a device with `genericDisplayType` and no `genericDeviceType` | the attribute was ignored | the attribute is used, e.g. Outlet instead of Switch | `attr <device> genericDeviceType switch` |
| a `genericDeviceType window` device that is set with `set pct` | Window with Brightness | Window with position, without Brightness | none |
| HMCCUCHN and HMCCUDEV devices for HomeMatic IP | many were not published, blinds were a Lightbulb | published from their datapoints: switch, dimmer, blind, thermostat, sensors, with battery and power values | `attr <device> genericDeviceType ignore` to leave one out, or `homebridgeMapping` |
| blinds with a `stop` command | no way to stop | additional HoldPosition characteristic | nothing to do |
| lights with a `ct` command and a `ct` reading, e.g. HUEDevice | no colour temperature | additional ColorTemperature characteristic | nothing to do |
| thermostats | Off, Heat, Cool and Auto offered | only the modes the device has. Heating state follows the valve position if it is known | `valid` in a `TargetHeatingCoolingState` mapping |
| a `Manufacturer`, `Model`, `SerialNumber` or `FirmwareRevision` mapping | also a characteristic of the device's own service, and the accessory information showed a placeholder | only in the accessory information, with its text | name the service in the mapping, e.g. `Outlet#FirmwareRevision=...` |
| a second service of the same type without a subtype of its own | homebridge refused the whole platform | that mapping is skipped with an error in the log | give it a subtype: `<service>(<subtype>)#<characteristic>` |

HomeMatic IP devices that the old plugin skipped appear as new accessories if your `filter`
selects them. A HomeKit bridge takes 149 accessories; the plugin logs a warning above that.

### Parses differently

| In `homebridgeMapping` | Before | Now |
|---|---|---|
| `invert` without a value, e.g. `CurrentPosition=position,invert` | taken as the name of the reading | switches the inversion on |
| a JSON mapping that spans several lines | not recognised as JSON | recognised |
| `valid=` with names of values | the name was handed to HomeKit | the number is. Entries that are no value are dropped with an error, the list is sorted by number |
| a mapping with only `default=` | subscribed to a reading named `undefined` | has no reading and answers its default |
| names from before HAP-NodeJS 2, e.g. `BatteryService` | unknown under homebridge 2, became a Switch | known |
| `AccessoryCategory=` | always unknown under homebridge 2 | used |
| a custom characteristic with `cmdOn`, `cmdOff` or `cmds` but no `cmd` | read only | writable |
| `FirmwareRevision` with a reading like `V1.2.3-beta` | handed on as it was | the version in it, `1.2.3` |
| a command with `;`, `&`, `#` or `=` in it | cut short in the url | sent complete. `+` is still read as a blank |

`jsFunctions` is read as before: an absolute path, or one relative to the storage directory.

### Safe

- The plugin never ends the homebridge process. homebridge-fhem did when `ssl` was no boolean,
  and after it had created the `genericDeviceType` attribute in fhem.
- A device the plugin fails on is left out with an error in the log. The other devices are
  published.
- When fhem refuses to list the devices, the plugin asks again instead of leaving homebridge
  hanging.
- A long poll that died without notice is noticed and opened again. Reads are answered within
  two seconds.
- The csrf token of fhem is no longer written to the log.
- Reads, events and the details of each device are logged at debug level only.
- Values are published to HomeKit in a way that Eve and other apps are notified under
  homebridge 2. Repeated presses of a button are reported each time.
- The debug page is still on port 8282, or 8283 when that is taken.

## Configuration

Every key homebridge-fhem read is read the same way: `platform`, `name`, `server`, `port`
(8083), `filter`, `ssl`, `webname` (`fhem`), `auth.user` and `auth.pass` (or `auth.username` and
`auth.password`), `jsFunctions`, `scope` and `neverTimeout`. No default changed.

Differences:

| Key | |
|---|---|
| `ssl` | a value that is no boolean ended homebridge. `"true"`, `"1"` and `1` are now taken as true with a warning, anything else as false with an error |
| `scope` | may also be a list |
| `auth.sendImmediately`, `auth.bearer` | not used any more, see above |
| `rejectUnauthorized` | new. `true` checks the certificate of fhem also with `auth`, `false` never checks it |
| `allowInlineFunctions` | new. `false` refuses JavaScript in `homebridgeMapping` attributes. It is allowed if not given, as before |
| `debugPort` | new. The port of the debug page, `false` or `0` for none |
| `debugHost` | new. The address the debug page listens on, e.g. `127.0.0.1` |

## Files

| File in the storage directory | |
|---|---|
| `config.json` | read as before |
| `persist/` | kept by homebridge. Holds the pairing and the ids of the accessories. Not touched by either plugin |
| `<host>_<FUUID>_persist.json` | the Eve history of a device, written by fakegato-history. Same name and place as before |
| the `jsFunctions` file | read as before |
| `fhem2hb-identities.json` | new. What every device was first published as |

homebridge-fhem2hb installs fakegato-history itself, as homebridge-fhem did.

## Coming from an older version

homebridge-fhem itself changed what it identifies some devices by. If you skip those versions,
the change reaches you with this plugin instead of with an update of homebridge-fhem. For the
devices below, the accessory comes up as a new one unless you pin its identity in fhem before
the first start with the new plugin.

| Your version | Devices | Was identified by | Is identified by | To keep the accessory |
|---|---|---|---|---|
| 0.5.40 or older | HMCCUDEV, HMCCUCHN | the `ccuaddr` internal, or the `FUUID` if the device has no `ccuaddr` | the `DEF` internal | `attr <device> homebridgeMapping SerialNumber=serial=<what it was>`, unless `DEF` is the same text |
| 0.5.44 or older | devices without `FUUID` and without a serial number of their own, with `_` in their name. fhem gives every device a `FUUID` since 2019 | the name as it is | the name with `-` for `_` | `attr <device> homebridgeMapping SerialNumber=serial=<name>` |
| 0.5.46 and 0.5.48 | the same devices, with anything but the letters a to z, digits, blanks and `'` in their name | the name without those characters | the name with `-` for `_` | `attr <device> homebridgeMapping SerialNumber=serial=<name without those characters>` |

If the device has a `homebridgeMapping` already, add the `SerialNumber=...` entry to it. The
serial number shown in HomeKit becomes that text.

Nothing else that an accessory is identified by changed in the published versions from 0.5.38
to 0.5.54: the serial numbers of the other device types and the file names of the Eve history are
the same in all of them.

## Going back

homebridge-fhem works out the same uuids, so going back keeps the accessories as well, as long
as homebridge never starts without one of the two plugins.

1. Stop homebridge.
2. Install homebridge-fhem and uninstall homebridge-fhem2hb, in this order, the way you
   installed them.

   ```sh
   npm install -g homebridge-fhem@0.5.54
   npm uninstall -g homebridge-fhem2hb
   ```

3. Remove the keys homebridge-fhem does not know from the FHEM entry if you added any. It
   ignores them, so this is optional. Remove `genericDeviceType` attributes you set only for the
   new plugin.
4. Start homebridge.

`fhem2hb-identities.json` can stay. homebridge-fhem does not read it, and it is right again if
you return.

If accessories did show up as new and you want the state from before the migration: stop
homebridge, put the plugins back as above, replace the storage directory with the backup, and
start homebridge. That restores what homebridge knows. What the Home app has forgotten in the
meantime, it does not get back from this.
