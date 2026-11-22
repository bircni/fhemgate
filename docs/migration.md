# Moving from homebridge-fhem

This is for an installation that runs [homebridge-fhem](https://github.com/justme-1968/homebridge-fhem)
and moves to homebridge-fhemgate. It is written against homebridge-fhem 0.5.54, the last version
on npm. If yours is older than 0.5.50, read [Coming from an older version](#coming-from-an-older-version)
first.

homebridge-fhemgate replaces homebridge-fhem. It reads the same `homebridgeMapping` and
`genericDeviceType` attributes in fhem, and the same keys in its `config.json` entry. Two things
in the entry change: the platform is called `fhemgate`, and `migrateFrom` says what it was called
before. Done in the order below, HomeKit keeps your accessories with their rooms, names, scenes
and automations.

## What HomeKit keeps, and why

HomeKit knows a bridged accessory by an id that homebridge hands out and keeps in
`persist/IdentifierCache.<bridge>.json` in its storage directory. homebridge finds that id again
by the uuid of the accessory. For homebridge-fhem it made the uuid from the `platform` value of the
config entry, `FHEM`, and the serial number the plugin works out for the device (or its name, if it
has none).

homebridge-fhemgate makes the uuid itself, the same way: from the platform name in `migrateFrom`,
or `FHEM` without it, and from name and serial number, which it works out as homebridge-fhem did
for every device type. The tests of this plugin check that for every device fixture against what
homebridge-fhem 0.5.54 did, and start a real homebridge on a storage directory as homebridge-fhem
left it. This was not tried against a real HomeKit home, so keep the backup until you have looked
at yours.

The uuid alone is not enough. When homebridge publishes the bridge, it drops the id of every
accessory that is not on the bridge at that moment, unless nothing at all is on it. homebridge-fhem
put its accessories on the bridge before it was published. homebridge-fhemgate is a dynamic
platform: homebridge publishes the accessories it kept from the last start right away, and the
plugin adds the others once fhem answers. On the first start there are none it kept, so the
plugin would be too late on a bridge that also has accessories of other plugins. `migrateFrom`
makes it fetch the devices from fhem before homebridge publishes the bridge, on that first start.

HomeKit forgets the accessories of fhem during a migration when:

1. homebridge starts with the old entry, `"platform": "FHEM"`, and without homebridge-fhem. No
   plugin serves the entry, and homebridge publishes the bridge without the fhem accessories.
   homebridge-fhemgate says so in the log, with a line that starts with
   `homebridge-fhemgate: config.json has a platform "FHEM", which no plugin serves`.
2. homebridge starts with the new entry but without `migrateFrom`, and the bridge has
   accessories of other plugins.
3. fhem can not be reached on that first start. The plugin waits half a minute for it, then logs
   `migrateFrom: fhem could not be asked for its devices before homebridge publishes the bridge`.

So: stop homebridge first, change plugin and entry while it is stopped, and start it once, with
fhem running. From then on homebridge keeps the accessories itself, also while fhem is away.

## Before you start

1. Check the versions. homebridge-fhemgate needs Node 22.12 or later, 24 or 26, and homebridge
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
   `-P` option of homebridge, or what your installer set up). Install the new plugin into the same
   `node_modules` directory as the old one.

4. Look at the `platform` value of your FHEM entry in `config.json`. It is `"FHEM"`, or, less
   common, `"homebridge-fhem.FHEM"`. Write it down: it becomes `migrateFrom`.

   If you have several FHEM entries on one bridge, see [several entries](#several-entries).

5. Stop homebridge, and make sure nothing starts it again before the last step: a service
   manager that restarts it, or a user interface that restarts it after a plugin was installed
   or removed.

6. Back up the storage directory. For the default directory:

   ```sh
   cp -a ~/.homebridge ~/.homebridge.before-fhemgate
   ```

   The backup holds what is needed to go back: `config.json`, `persist/` (the pairing and the
   ids of the accessories), `accessories/`, and the Eve histories in `*_persist.json`.

7. Make sure fhem is running, and do not restart it between the last start with homebridge-fhem
   and the first start with homebridge-fhemgate. This matters for `HUEDevice` devices: their
   accessory is identified by the `uniqueid` internal once the hue bridge has reported it, and by
   the `FUUID` before. homebridge-fhem worked that out anew on every start. homebridge-fhemgate
   writes down what it finds on its first start and keeps it from then on. In fhem,

   ```
   list TYPE=HUEDevice uniqueid
   ```

   should show the `uniqueid` of your lamps, and none of them as `ff:ff:ff:ff:ff:ff:ff:ff-0b`.
   A device that never has one is identified by its `FUUID` either way.

## Steps

1. With homebridge stopped, install homebridge-fhemgate from npm the way homebridge-fhem was
   installed. For a global installation:

   ```sh
   npm install -g homebridge-fhemgate
   ```

   Use `sudo` if you needed it to install homebridge-fhem. If your plugins are in a directory of
   their own, use the command you installed homebridge-fhem with, with `homebridge-fhemgate` in
   place of `homebridge-fhem`.

   Do not install it from the plugins page of the Homebridge UI: the UI may restart homebridge
   before the entry is changed, which is case 1 above.

2. Still with homebridge stopped, uninstall homebridge-fhem from the same place.

   ```sh
   npm uninstall -g homebridge-fhem
   ```

3. Change the entry in `config.json`, in an editor or the JSON editor of the Homebridge UI:
   `platform` becomes `"fhemgate"`, and `migrateFrom` gets what `platform` was. Leave everything
   else as it is, `_bridge` included.

   ```json
   {
     "platform": "fhemgate",
     "migrateFrom": "FHEM",
     "name": "FHEM",
     "server": "127.0.0.1",
     "port": 8083,
     "filter": "room=HomeKit"
   }
   ```

   For an entry that said `"platform": "homebridge-fhem.FHEM"`, `migrateFrom` is
   `"homebridge-fhem.FHEM"`.

   `neverTimeout` is not needed any more and can be removed: the plugin keeps trying to reach fhem
   for as long as homebridge runs. If your `auth` has keys other than `user` and `pass` (or
   `username` and `password`), see [Configuration](#configuration).

4. Start homebridge.

`migrateFrom` stays in the entry. It does nothing more once homebridge has kept the accessories,
but the uuids are made with it: without it, or with another value, HomeKit sees every accessory as
a new one, and the ones homebridge kept stay without response until they are removed in the
Homebridge UI.

### Several entries

homebridge runs a dynamic platform once per bridge, so several FHEM entries on one bridge become
one entry with [`connections`](configuration.md#several-fhem-servers): the first entry stays, and
each of the others moves into its `connections` list as it was, without `platform` and `name`.
The uuids were made with the same platform name for all of them, so one `migrateFrom` is right
for all. Entries on child bridges of their own stay entries of their own, each with its
`migrateFrom`.

### Coming from homebridge-fhemgate 0.1

Version 0.1 of this plugin answered to the platform names of homebridge-fhem. Its entry changes
the same way, before the update is started: `platform` becomes `"fhemgate"` and `migrateFrom` gets
what `platform` was, `"FHEM"` or `"homebridge-fhemgate.FHEM"`. Then update the plugin while
homebridge is stopped, and start it.

## Check afterwards

In the log of homebridge:

- `this is homebridge-fhemgate <version>` shows that the new plugin was loaded.
- `migrateFrom: fetching the devices from fhem before homebridge publishes the bridge` shows that
  the devices were fetched in time. On a later start this line does not appear.
- `Fetching FHEM devices...` and `got: <n> results` show that fhem answered, with the number of
  devices you expect. The plugin logs one line per device, like `lamp is switch`. The details it
  used to log are only shown when homebridge runs with debug logging (`-D`).
- There is no line that starts with `homebridge-fhemgate: config.json has a platform`, and none
  with `migrateFrom: fhem could not be asked` or `No plugin was found for the platform`.
- Lines of the plugin with `config:` in them name a key of your entry that needs attention.

In the storage directory, there is a new file `fhemgate-identities.json`. It lists what every
device was first published as, by its `FUUID`. Keep it: with it a device stays the same accessory
when what fhem reports about it changes. `accessories/cachedAccessories` now holds the accessories
of fhem as well.

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
| The platform name | `FHEM` | `fhemgate`, and `migrateFrom` with the name before | change the entry, see the steps |
| Several FHEM entries on one bridge | each a platform | one entry with `connections` | see [several entries](#several-entries) |
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
| `invert=false`, `readOnly=false`, `nocache=0` | switched the parameter on | switch it off. Any other value but an empty one switches it on |
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
- homebridge keeps the accessories from one start to the next. It starts without waiting for
  fhem, and HomeKit keeps the accessories while fhem can not be reached. They answer that they do
  not respond, until fhem is back.
- An accessory is removed only when fhem has listed its devices without it, or with it left out
  on purpose, and still does ten minutes later. A device the plugin fails on keeps its accessory.
- When fhem refuses to list the devices, the plugin asks again.
- A long poll that died without notice is noticed and opened again. Reads are answered within
  two seconds.
- The csrf token of fhem is no longer written to the log.
- Reads, events and the details of each device are logged at debug level only.
- Values are published to HomeKit in a way that Eve and other apps are notified under
  homebridge 2. Repeated presses of a button are reported each time.
- The debug page is still on port 8282, or 8283 when that is taken.

## Configuration

Every key homebridge-fhem read is read the same way, but for `platform`: `name`, `server`, `port`
(8083), `filter`, `ssl`, `webname` (`fhem`), `auth.user` and `auth.pass` (or `auth.username` and
`auth.password`), `jsFunctions` and `scope`. No default changed.

Differences:

| Key | |
|---|---|
| `platform` | `fhemgate` |
| `migrateFrom` | new. What `platform` said for homebridge-fhem |
| `connections` | new. More fhem for the entry |
| `neverTimeout` | not needed any more: fhem is tried for as long as homebridge runs |
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
| `accessories/cachedAccessories` | kept by homebridge. Holds the accessories of fhem now, homebridge-fhem had none there |
| `<host>_<FUUID>_persist.json` | the Eve history of a device, written by fakegato-history. Same name and place as before |
| the `jsFunctions` file | read as before |
| `fhemgate-identities.json` | new. What every device was first published as |

homebridge-fhemgate installs fakegato-history itself, as homebridge-fhem did.

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
as homebridge never starts with an entry no installed plugin serves.

1. Stop homebridge.
2. Install homebridge-fhem and uninstall homebridge-fhemgate, the way you installed them.

   ```sh
   npm install -g homebridge-fhem@0.5.54
   npm uninstall -g homebridge-fhemgate
   ```

3. Change the entry back: `platform` gets what `migrateFrom` says, and `migrateFrom` can go.
   Entries you merged into `connections` become entries of their own again. Remove
   `genericDeviceType` attributes you set only for the new plugin.
4. Start homebridge. It drops the accessories of homebridge-fhemgate from
   `accessories/cachedAccessories`, as no plugin serves them any more, and publishes the ones of
   homebridge-fhem under the same ids. Do not start it with `-K`
   (keepOrphanedCachedAccessories): it would keep both.

`fhemgate-identities.json` can stay. homebridge-fhem does not read it, and it is right again if
you return.

If accessories did show up as new and you want the state from before the migration: stop
homebridge, put the plugins back as above, replace the storage directory with the backup, and
start homebridge. That restores what homebridge knows. What the Home app has forgotten in the
meantime, it does not get back from this.
