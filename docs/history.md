# History

The Eve app can show how a value developed over time: a temperature curve, when a door was opened,
how long the heating ran. The plugin keeps such a history with the
[fakegato-history](https://github.com/simont77/fakegato-history) package, which is installed
together with the plugin as an optional dependency. Apple's Home app does not show it.

## Switching it on

Add a `history` entry to the [`homebridgeMapping`](mapping.md) of the device and restart
Homebridge:

```
attr Door homebridgeMapping history=size=1024
```

`size` is the number of entries that are kept, 1024 if it is not given.

The kind of history follows from the service of the device:

| Service | `genericDeviceType` | History type | Records |
| --- | --- | --- | --- |
| TemperatureSensor | `thermometer` | `weather` | temperature, humidity, air pressure |
| Thermostat | `thermostat` | `thermo` | current and target temperature, valve position |
| ContactSensor | `contact` | `door` | open and closed, and how often it was opened |
| MotionSensor | `MotionSensor` | `motion` | motion |
| AirQualitySensor | `AirQualitySensor` | `room` | the ppm value of the `voc` or `co2` reading |

For any other service the entry has to name the type, otherwise the log has
`history: no type known for <service>`:

```
attr Plug homebridgeMapping history=type=energy
```

A plug with a `power` reading then records its power.

## What to know

- An accessory has one history. A second `history` entry is refused with a line in the log.
- The history is stored in the storage directory of Homebridge, in files whose names end in
  `_persist.json`, and survives a restart. It is written again when Homebridge shuts down.
- A contact sensor with a history also gets the counters Eve shows: times opened and last
  activation, with a reset. A motion sensor gets the last activation.
- A contact sensor with a history only shows `ContactSensorState`. A `CurrentDoorState` mapping of
  the same device is skipped, with a line in the log.
- If the log has `fakegato-history not installed`, the optional dependency was left out when the
  plugin was installed. Install `fakegato-history` next to the plugin.
