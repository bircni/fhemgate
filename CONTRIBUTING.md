# Contributing

## Setup

The project uses [bun](https://bun.sh) to install dependencies and run scripts, and Node to run
the tests, because homebridge runs the plugin on Node.

```sh
bun install
bun run verify
```

`bun run verify` runs everything CI runs, except the job against a real fhem: format check, lint, typecheck,
tests with coverage, build, a check that the packed plugin installs with npm and loads, and the
end-to-end tests.

| Script | Does |
|---|---|
| `bun run format` | formats the code with oxfmt |
| `bun run lint` | oxlint with its type-aware rules, no warnings allowed |
| `bun run typecheck` | TypeScript over `src`, `test` and `scripts` |
| `bun run test` | all tests |
| `bun run coverage` | all tests with a coverage report in `coverage/` |
| `bun run build` | compiles `src` to `dist` |
| `bun run pack-smoke` | packs, installs and loads the plugin |
| `bun run test:e2e` | builds, then runs a real homebridge with the plugin against the stand-in fhem |

## Layout

| Directory | Holds |
|---|---|
| `src/devices` | the detection: what a fhem device is and how its readings map to HomeKit, one rule module per device family under `rules/` |
| `src/mapping` | mappings between a reading and a characteristic: the `homebridgeMapping` parser, and the conversion of values in both directions |
| `src/accessory` | the accessory homebridge sees, its services and the Eve history |
| `src/fhem` | the connection to FHEMWEB: the long poll for events and the commands |
| `src/state` | the readings the plugin has seen and who is subscribed to them |
| `test` | the suites that run whole devices through the plugin, their fixtures and a stand-in FHEMWEB |

Unit tests sit next to the module they test, as `*.test.ts`.

The end-to-end tests in `test/e2e` start a real homebridge that loads the built plugin and read
and write its accessories the way a HomeKit controller does. `fixtures.e2e.ts` serves every device
fixture and compares what homebridge publishes with what the plugin builds. `scenarios.e2e.ts`
sends values both ways for one device of every common kind. With `E2E_FHEM_URL` set to the url of
a FHEMWEB, the scenarios run against that fhem instead of the stand-in. They define dummy devices
named `e2e_*` there and overwrite the `userattr` attribute of `global`, so only point it at a fhem
that is there to be tested with.

## Behaviour is pinned by tests

The plugin knows the quirks of many fhem device types, and nobody owns hardware for all of them.
The tests therefore record what the plugin does today for each kind of device. A change that
alters a recorded result has to say why, in the pull request.

Behaviour that is recorded but wrong is listed in [docs/KNOWN_BUGS.md](docs/KNOWN_BUGS.md). Fix
one of those in a pull request of its own, together with the changed test.

## Adding a device

1. Run `jsonlist2 <device>` in fhem and take the object from its `Results` list.
2. Replace anything private: names, addresses, serial numbers.
3. Save it as `test/fixtures/devices/<family>/<name>.json`.
4. Run `bun run test`. The new fixture is picked up by the fixture suites, which record what the
   plugin makes of it. Check the recorded result before committing it.
