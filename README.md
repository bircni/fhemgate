# fhemgate

[![npm](https://img.shields.io/npm/v/homebridge-fhemgate)](https://www.npmjs.com/package/homebridge-fhemgate)
[![CI](https://github.com/bircni/fhemgate/actions/workflows/ci.yml/badge.svg?branch=main)](https://github.com/bircni/fhemgate/actions/workflows/ci.yml)

A [Homebridge](https://homebridge.io) platform plugin that publishes the devices of a
[FHEM](https://fhem.de) installation to HomeKit. It follows the events of FHEM over a long poll, so
HomeKit shows a change as soon as FHEM reports it.

> This project is based on [homebridge-fhem](https://github.com/justme-1968/homebridge-fhem) by
justme1968 and its contributors. The `homebridgeMapping` and `genericDeviceType` attributes work as
before, and so does the configuration, under the platform name `fhemgate`. HomeKit keeps the
accessories of homebridge-fhem with their rooms and automations: see
[moving from homebridge-fhem](docs/migration.md).

Homebridge keeps the accessories from one start to the next. It starts without waiting for FHEM,
and while FHEM is away the accessories stay and show as not responding.

## Requirements

| | Version |
| --- | --- |
| Node.js | 22.12 or later, 24 or 26 |
| Homebridge | 1.8 or later, or 2.x |
| FHEM | any version with FHEMWEB and `jsonlist2` |

## Install

Install the plugin from npm:

```sh
npm install -g homebridge-fhemgate
```

With the [Homebridge UI](https://github.com/homebridge/homebridge-config-ui-x), search for
`homebridge-fhemgate` on its Plugins page and install it there.

If you use homebridge-fhem today, follow [moving from homebridge-fhem](docs/migration.md) instead.

## Configure

Add a `fhemgate` platform to the `config.json` of Homebridge:

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

`server` and `port` are those of FHEMWEB. `filter` is a FHEM devspec that selects the devices to
publish; without it every device of FHEM is published. All options, with examples for a password,
https and several FHEM installations, are in [docs/configuration.md](docs/configuration.md).

## Make a device appear

1. Start Homebridge once with the platform configured. The plugin adds the attributes
   `genericDeviceType` and `homebridgeMapping` to FHEM.
2. Put the device where the filter finds it, and say what it is if the plugin can not tell:

   ```
   attr Lamp room HomeKit
   attr Lamp genericDeviceType light
   attr Lamp siriName Desk lamp
   ```

   `siriName` is the name HomeKit shows. Without it the `alias` of the device is used, or its name.
3. Restart Homebridge. The devices and their attributes are read once, when Homebridge starts.

The log of Homebridge then has a line `Lamp is light`. Many devices need no `genericDeviceType`:
see [docs/devices.md](docs/devices.md) for what is recognised by itself.

## Documentation

| Page | Holds |
| --- | --- |
| [Configuration](docs/configuration.md) | every option of the platform, password and https, several FHEM servers, the debug page |
| [Devices](docs/devices.md) | which FHEM devices become which HomeKit accessories, `genericDeviceType`, how to check what was detected |
| [Mapping](docs/mapping.md) | the `homebridgeMapping` attribute: syntax, every parameter, examples and recipes |
| [History](docs/history.md) | the history the Eve app shows |
| [Troubleshooting](docs/troubleshooting.md) | what to check when something is not as expected |
| [Moving from homebridge-fhem](docs/migration.md) | what changes for an existing installation |
| [Contributing](CONTRIBUTING.md) | working on the plugin |

## Licence

[ISC](LICENSE)
