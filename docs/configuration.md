# Configuration

Every FHEM installation is one platform entry in the `config.json` of Homebridge. The platform is
called `FHEM`.

```json
{
  "platforms": [
    {
      "platform": "FHEM",
      "name": "FHEM",
      "server": "127.0.0.1",
      "port": 8083,
      "filter": "room=HomeKit"
    }
  ]
}
```

The plugin reads the devices and their attributes once, when Homebridge starts. After a change to
the configuration, to the filter result or to an attribute of a device, restart Homebridge.

## Options

| Option | Type | Default | Meaning |
| --- | --- | --- | --- |
| `platform` | text | | Has to be `FHEM`. |
| `name` | text | | The name of the platform in the log of Homebridge. |
| `server` | text | | Host name or address of FHEM. Required: without it the platform logs `incomplete configuration` and publishes nothing. |
| `port` | number | `8083` | The port of FHEMWEB. |
| `webname` | text | `fhem` | The `webname` of the FHEMWEB instance, the path in its address. |
| `ssl` | boolean | `false` | `true` to talk https to FHEMWEB. |
| `rejectUnauthorized` | boolean | see [https](#https) | With `ssl`: whether FHEM has to show a certificate Node.js trusts. |
| `auth` | object | none | User and password of FHEMWEB: `{ "user": "...", "pass": "..." }`. |
| `filter` | text | all devices | The FHEM devspec of the devices to publish. |
| `scope` | text or list | none | See [scope](#scope). |
| `jsFunctions` | text | none | A file with functions for mappings. See [jsFunctions](#jsfunctions). |
| `allowInlineFunctions` | boolean | `true` | `false` to refuse JavaScript in mappings. See [who is trusted](#who-is-trusted). |
| `neverTimeout` | boolean | `false` | `true` to keep trying for ever when FHEM can not be reached while Homebridge starts. |
| `debugPort` | number or `false` | `8282` | The port of the [debug page](#debug-page). `false` or `0` switches it off. |
| `debugHost` | text | all addresses | The address the debug page listens on. |

Notes:

- The settings form of the Homebridge UI offers `siriName=.+` as `filter`, which selects every
  device with a `siriName` attribute. It does not offer `webname`, `scope` and `jsFunctions`: set
  those in the JSON editor.
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
  "platform": "FHEM",
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
  "platform": "FHEM",
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

## Several platforms

Each FHEM installation, or each part of one, is an entry of its own:

```json
{
  "platforms": [
    { "platform": "FHEM", "name": "FHEM ground floor", "server": "127.0.0.1", "filter": "room=HomeKitGround" },
    { "platform": "FHEM", "name": "FHEM upstairs", "server": "127.0.0.1", "filter": "room=HomeKitUp" },
    { "platform": "FHEM", "name": "FHEM garden", "server": "192.168.1.20", "port": 8088, "webname": "garden" }
  ]
}
```

- A device that two platforms select is published once, by the first platform that lists it.
- A HomeKit bridge takes 149 accessories. The plugin warns in the log when a platform publishes
  more. Split the devices over several platforms with different filters and run each as a child
  bridge of Homebridge.
- All platforms share one debug page, unless they name different ports.

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
  `"allowInlineFunctions": false` for the platform. Mappings with such a function then lose it,
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
