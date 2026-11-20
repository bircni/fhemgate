# Configuration

The plugin is one platform entry in the `config.json` of Homebridge. The platform is called
`fhemgate`. Coming from homebridge-fhem, whose platform was called `FHEM`, read
[moving from homebridge-fhem](migration.md) first.

```json
{
  "platforms": [
    {
      "platform": "fhemgate",
      "name": "FHEM",
      "server": "127.0.0.1",
      "port": 8083,
      "filter": "room=HomeKit"
    }
  ]
}
```

Homebridge keeps the accessories from one start to the next and publishes them as soon as it
starts, before FHEM answers. The plugin reads the devices and their attributes every time it
reaches FHEM: when Homebridge starts, and when FHEM comes back after it was away. After a change to
the configuration, to the filter result or to an attribute of a device, restart Homebridge.

While FHEM can not be reached, the accessories stay, and HomeKit shows them as not responding. An
accessory is removed when FHEM no longer lists its device, or lists it left out on purpose (with
`genericDeviceType ignore`, outside the filter or the `scope`), and still does ten minutes later.
A device FHEM lists but the plugin can not make an accessory of keeps its accessory.

## Options

| Option | Type | Default | Meaning |
| --- | --- | --- | --- |
| `platform` | text | | Has to be `fhemgate`. |
| `name` | text | | The name of the platform in the log of Homebridge. |
| `server` | text | | Host name or address of FHEM. Required unless the entry has `connections`: without it the entry logs `incomplete configuration` and publishes nothing of its own. |
| `port` | number | `8083` | The port of FHEMWEB. |
| `webname` | text | `fhem` | The `webname` of the FHEMWEB instance, the path in its address. |
| `ssl` | boolean | `false` | `true` to talk https to FHEMWEB. |
| `rejectUnauthorized` | boolean | see [https](#https) | With `ssl`: whether FHEM has to show a certificate Node.js trusts. |
| `auth` | object | none | User and password of FHEMWEB: `{ "user": "...", "pass": "..." }`. |
| `filter` | text | all devices | The FHEM devspec of the devices to publish. |
| `scope` | text or list | none | See [scope](#scope). |
| `jsFunctions` | text | none | A file with functions for mappings. See [jsFunctions](#jsfunctions). |
| `allowInlineFunctions` | boolean | `true` | `false` to refuse JavaScript in mappings. See [who is trusted](#who-is-trusted). |
| `migrateFrom` | text | none | Only for an entry that was a platform of homebridge-fhem: what it said for `platform`. See [moving from homebridge-fhem](migration.md). |
| `neverTimeout` | boolean | | Not needed any more: FHEM is tried for as long as Homebridge runs. |
| `debugPort` | number or `false` | `8282` | The port of the [debug page](#debug-page). `false` or `0` switches it off. |
| `debugHost` | text | all addresses | The address the debug page listens on. |
| `connections` | list | none | More FHEM servers for this entry, see [several FHEM servers](#several-fhem-servers). |

Notes:

- The settings form of the Homebridge UI offers `siriName=.+` as `filter`, which selects every
  device with a `siriName` attribute.
- `ssl` has to be `true` or `false`. The text `"true"` or `"1"` is taken as `true` with a warning in
  the log, any other text as `false` with an error.
- `auth` also takes the names `username` and `password`.

## Filter

`filter` is a devspec as FHEM itself understands it, the same you would give to `list`. Try it in
FHEM first: `list room=HomeKit` shows what the plugin will get.

```json
"filter": "room=HomeKit"
```

```json
"filter": "siriName=.+"
```

```json
"filter": "room=HomeKit:FILTER=TYPE!=dummy"
```

A device that matches the filter and has `genericDeviceType` set to `ignore` is not published.

## Password

For a FHEMWEB that is protected with an `allowed` device and `basicAuth`:

```json
{
  "platform": "fhemgate",
  "name": "FHEM",
  "server": "fhem.example.org",
  "port": 8083,
  "auth": { "user": "homebridge", "pass": "secret" }
}
```

The csrf token of FHEMWEB is handled by the plugin. There is nothing to configure for it.

## https

For a FHEMWEB with `attr WEB HTTPS 1`:

```json
{
  "platform": "fhemgate",
  "name": "FHEM",
  "server": "fhem.example.org",
  "port": 8083,
  "ssl": true,
  "rejectUnauthorized": false
}
```

`rejectUnauthorized` decides whether the certificate of FHEM is checked:

| `rejectUnauthorized` | The certificate is |
| --- | --- |
| `true` | always checked |
| `false` | never checked, as needed for the self-signed certificate FHEM makes itself |
| not given, with `auth` | **not checked** |
| not given, without `auth` | checked |

The behaviour without the option is the one of homebridge-fhem. Without the check the connection is
encrypted, but anybody in the network can pose as FHEM and is sent user and password. If FHEM has a
certificate Node.js trusts, set `"rejectUnauthorized": true`.

When the certificate is refused, the log says `the certificate of fhem is not trusted` and the
plugin keeps trying.

## Several FHEM servers

One entry can publish the devices of several FHEM servers. `connections` lists the others, each
with the options of the table above that are about one FHEM: `server`, `port`, `webname`, `ssl`,
`rejectUnauthorized`, `auth`, `filter`, `scope`, `jsFunctions` and `allowInlineFunctions`. A connection takes none of them from the entry, not even `allowInlineFunctions`: give each
connection `"allowInlineFunctions": false` that is to refuse JavaScript.

```json
{
  "platform": "fhemgate",
  "server": "127.0.0.1",
  "filter": "room=HomeKit",
  "connections": [{ "server": "192.168.1.20", "port": 8088, "webname": "garden" }]
}
```

An entry without `server` publishes only the devices of its connections. Device names have to
differ between them: a device whose name another FHEM of the entry already published is left out,
with `<name> is already published` in the log.

Homebridge runs the platform once per bridge, so all FHEM servers of one bridge are one entry
with `connections`. Two connections can talk to the same FHEM with different filters; they share
one long poll.

## More than 149 accessories

A HomeKit bridge takes 149 accessories. The plugin publishes no more and says in the log which
devices it left out. Split the devices over several entries with different filters and run each
as a child bridge of Homebridge, with `_bridge` in the entry. All entries share one debug page,
unless they name different ports.

## Scope

`scope` exists so that one configuration can be shared with other FHEM bridges. This plugin only
looks for the scope `siri`: a platform with a `scope` that does not contain `siri` publishes
nothing. Without `scope` everything is published. It takes a list or text separated by commas:

```json
"scope": "alexa,siri"
```

```json
"scope": ["alexa", "siri"]
```

## jsFunctions

A mapping can convert a value with a JavaScript function of yours, see
[reading2homekit and homekit2reading](mapping.md#functions). `jsFunctions` names the file that
holds them. A path that does not start with `/` is relative to the storage directory of Homebridge,
the one `config.json` is in.

```json
"jsFunctions": "fhem-functions.cjs"
```

The file is a CommonJS module that exports the functions by name. Each one is called with the
mapping and the value, and returns the converted value:

```js
module.exports = {
  // reading2homekit: a reading of 0-255 as a brightness in percent
  byteToPercent: (mapping, orig) => Math.round(Number(orig) / 2.55),
  // homekit2reading: and back
  percentToByte: (mapping, orig) => Math.round(orig * 2.55),
};
```

```
attr Lamp homebridgeMapping Brightness=level::level,reading2homekit=byteToPercent,homekit2reading=percentToByte
```

A file that can not be loaded is reported in the log with `jsFunctions:` and the reason. The
mappings that name a function from it then work without the function.

## Who is trusted

The plugin does what FHEM tells it to. Two things reach further than the devices themselves:

- A `homebridgeMapping` can carry JavaScript: `reading2homekit` and `homekit2reading` take the body
  of a function between braces, and the plugin runs it inside Homebridge with the rights Homebridge
  has. **Whoever can set attributes in FHEM can therefore run code on the machine Homebridge runs
  on.** If FHEM is not as protected as Homebridge, or you do not use this, set
  `"allowInlineFunctions": false` for the platform, and for each of its `connections`. Mappings with such a function then lose it,
  with a line in the log, and everything else goes on working. Functions from the `jsFunctions`
  file are not affected: that file lies on the Homebridge machine.
- The `jsFunctions` file is loaded as code. Keep it where only the Homebridge user can write.

## Debug page

The plugin serves a small web page that shows what it knows:

| Address | Shows |
| --- | --- |
| `http://<homebridge>:8282/cached` | the state of the connection to each FHEM, and for every reading the plugin follows its value in FHEM and the value of each characteristic made from it |
| `http://<homebridge>:8282/subscriptions` | which characteristic follows which reading, with the whole mapping |

- The port is `8282`. When that is taken and no `debugPort` is configured, `8283` is tried. The
  log has a line `debug server listening on ...` with the port in use.
- `"debugPort": false` or `"debugPort": 0` switches the page off.
- The page asks for no password and listens on all addresses of the machine, so **anybody who
  reaches the port can read the names and readings of the devices**. To reach it from the Homebridge
  machine only:

  ```json
  "debugHost": "127.0.0.1"
  ```

## Log level

The plugin has no option for the log level. At the usual level it writes one line per device when
Homebridge starts, what HomeKit writes to a device, and warnings and errors. Reads, the events of
FHEM, the mappings of each device and the addresses that are asked are logged for debugging only:
start Homebridge with `-D`, or switch on the debug mode in the settings of the Homebridge UI (for a
child bridge: in the settings of that bridge).
