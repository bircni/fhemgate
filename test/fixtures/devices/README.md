# Device fixtures

One file per device, in the form fhem's `jsonlist2 <device>` reports it (one entry of its
`Results` list). The fixture suites in `test/devices.test.ts` run every file through the plugin
and record what comes out: the detected service, the mappings, the HomeKit services, how readings
are converted and which commands are sent.

Most of these devices were written from the detection code, not captured from hardware. They
cover the branches of the detection, but a real device may report more readings or different
values. Replace a file with a real `jsonlist2` result whenever one is available, with names,
addresses and serial numbers changed.

`hmccu/captured/` holds devices captured from a real installation behind a CCU, with their
readings and the HMCCU attributes that shape them as they were. Only what identifies the
installation was replaced: names, aliases, rooms, addresses, serial numbers and FUUIDs. Attributes
that neither the plugin nor the shape of the readings depend on were left out.

The directories group the devices by what they are meant to be detected as. `mapping/` holds
devices whose `homebridgeMapping` attribute is the point of the fixture, and `ignored/` those
the plugin does not expose.
