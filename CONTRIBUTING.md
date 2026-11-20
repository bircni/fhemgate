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
| `bun run coverage:e2e` | the same, and reports which lines of `src` the homebridge processes ran |
| `bun run release` | prepares a release, see [Releasing](#releasing) |

## Installing from a checkout

To try a change in a real homebridge, pack the plugin and install the tarball where homebridge
looks for its plugins. The machine homebridge runs on needs npm, not bun.

```sh
bun install --frozen-lockfile
bun run build
bun pm pack
npm install -g ./homebridge-fhemgate-<version>.tgz
```

## Layout

| Directory | Holds |
|---|---|
| `src/devices` | the detection: what a fhem device is and how its readings map to HomeKit, one rule module per device family under `rules/` |
| `src/mapping` | mappings between a reading and a characteristic: the `homebridgeMapping` parser, and the conversion of values in both directions |
| `src/accessory` | the accessory homebridge sees, its services and the Eve history |
| `src/fhem` | the connection to FHEMWEB: the long poll for events and the commands |
| `src/state` | the readings the plugin has seen and who is subscribed to them |
| `src/debug` | the debug page |
| `test` | the suites that run whole devices through the plugin, their fixtures and a stand-in FHEMWEB |
| `scripts` | what `bun run` needs besides the tools: the pack check, the coverage of the end-to-end tests, the release, and the check of a pushed tag the release workflow runs |
| `docs` | the documentation for users, which the README links to |

Unit tests sit next to the module they test, as `*.test.ts`.

The end-to-end tests in `test/e2e` start a real homebridge that loads the built plugin. They read
and write its accessories the way a HomeKit controller does, and are notified by it about changes.

| File | Holds |
|---|---|
| `scenarios.e2e.ts` | one device of every common kind, values both ways, identify, the filter |
| `devices.e2e.ts` | every kind of device the detection knows that a dummy device can be |
| `mappings.e2e.ts` | what the `homebridgeMapping` attribute can say, one device per feature |
| `history.e2e.ts` | the Eve history with the real fakegato-history |
| `hardware.e2e.ts` | device types of other fhem modules, and the `eventMap` attribute |
| `platform.e2e.ts` | the options of the platform, several platforms, what ends homebridge |
| `connection.e2e.ts` | a fhem that is not there, restarts, or sends events in pieces |
| `migration.e2e.ts` | a storage directory as homebridge-fhem left it: the accessories keep their ids, a `homebridge-fhem.FHEM` entry, both plugins installed |
| `reads.e2e.ts` | a fhem that takes its time to answer what HomeKit reads |
| `refresh.e2e.ts` | the reading fhem is asked for in the background, once a minute at most. takes that minute. |
| `fixtures.e2e.ts` | every device fixture: is what homebridge publishes what the plugin builds? |

The devices of the first four are dummy devices. With `E2E_FHEM_URL` set to the url of a FHEMWEB,
these files run against that fhem instead of the stand-in, and the others skip themselves. The
tests define dummy devices named `e2e_*` there and overwrite the `userattr` attribute of `global`,
so only point it at a fhem that is there to be tested with. A test that needs the stand-in goes
into one of the other files, or checks for `fhem.fake`.

The homebridge the tests start is the one `bun install` puts into `node_modules`, the version the
plugin is built with. With `E2E_HOMEBRIDGE` set to the directory of another installed homebridge
they start that one, which is how CI runs them against the oldest homebridge the plugin supports:

```sh
npm install --prefix /tmp/homebridge-1.8.0 homebridge@1.8.0
E2E_HOMEBRIDGE=/tmp/homebridge-1.8.0/node_modules/homebridge bun run test:e2e
```

The files run side by side, each with a fhem and a homebridge of its own. A homebridge takes up
to five seconds to end, which the tests do not wait for: the run ends once the last one is gone.
A test that has to wait long goes into a file of its own, like the one in `refresh.e2e.ts`, so
that the run takes no longer than that wait.

## Behaviour is pinned by tests

The plugin knows the quirks of many fhem device types, and nobody owns hardware for all of them.
The tests therefore record what the plugin does today for each kind of device. A change that
alters a recorded result has to say why, in the pull request.

Behaviour that is recorded but wrong is tracked as an issue of this repository. Fix
one of those in a pull request of its own, together with the changed test.

## Documentation

`README.md` is the short introduction, and `docs/` holds one page per subject: the options of the
platform, the detection, the `homebridgeMapping` attribute, the history and the troubleshooting. A
change to an option, to what is detected or to what a mapping can say changes the page that
describes it in the same pull request. `docs/` is for users of the plugin only; notes on the work
itself belong into issues and pull requests.

## Adding a device

1. Run `jsonlist2 <device>` in fhem and take the object from its `Results` list.
2. Replace anything private: names, addresses, serial numbers.
3. Save it as `test/fixtures/devices/<family>/<name>.json`.
4. Run `bun run test`. The new fixture is picked up by the fixture suites, which record what the
   plugin makes of it. Check the recorded result before committing it.

## Releasing

A release is a commit on `main` that sets the version, with an annotated tag `vX.Y.Z` whose
message holds the release notes. `bun run release` makes both on your machine and nothing else:
it does not push and does not publish. Pushing the tag starts
[`.github/workflows/release.yml`](.github/workflows/release.yml), which publishes to npm and
creates the GitHub release. Nobody runs `npm publish` by hand, except for the very first version
(see below).

### Once, before the first release

npm can only trust a workflow to publish a package that exists, so the first version, `0.1.0`, is
published by hand, and every later one by the workflow.

1. Make the repository public. npm adds provenance only for a package published from a public
   repository.
2. Use an npm account with two-factor authentication.
3. On an up to date `main`, make the release and push only the commit:

   ```sh
   bun run release 0.1.0 --dry-run
   bun run release 0.1.0
   git push origin main
   ```

4. Publish the tagged commit by hand, with npm 11.5.1 or later. `prepublishOnly` runs
   `bun run verify` first, and `publishConfig` makes the package public.

   ```sh
   git checkout v0.1.0
   npm login
   npm publish
   git checkout main
   ```

5. Push the tag: `git push origin v0.1.0`. The workflow verifies the commit, finds `0.1.0` on npm
   already and leaves it, and creates the GitHub release.
6. Shortly before the second release, open the settings of `homebridge-fhemgate` on npmjs.com and
   add a trusted publisher for GitHub Actions: the user `bircni`, the repository `fhemgate`, the
   workflow file `release.yml`, no environment, allowed to `npm publish`. A new trusted publisher
   has to publish within two days, or it expires and has to be made again.
7. Once the second release is published by the workflow, choose, in the same settings under
   publishing access, to require two-factor authentication and disallow tokens. The trusted
   publisher is not affected by that.

### Every release

```sh
bun run release minor --dry-run   # shows the version, the dist-tag, the notes and what would be done
bun run release minor
git push origin main
git push origin vX.Y.Z
```

The argument is `patch`, `minor`, `major`, `prerelease` or a version like `1.0.0-rc.1`. They count
the way `npm version` does: from `0.1.0`, `patch` gives `0.1.1` and `minor` gives `0.2.0`;
`prerelease` gives `0.1.1-0`, and from `0.2.0-rc.0` it gives `0.2.0-rc.1`, while `patch` or
`minor` give `0.2.0`. The first release is asked for by its number: `bun run release 0.1.0`.

The script refuses to do anything unless the branch is `main`, the working tree is clean, local
`main` is the commit `origin/main` is at, the tag exists neither here nor on `origin`, and
`package.json` does not say `"private": true`. It then runs `bun run verify` and stops if that
fails. After that it

1. sets the version in `package.json`,
2. commits it as `chore(release): vX.Y.Z`,
3. tags the commit. The notes are made from the subjects of the commits since the release
   before, grouped into breaking changes (a `!` before the colon, or a `BREAKING CHANGE:` line in
   the body), features (`feat`), fixes (`fix`) and other changes. Commits of the types `build`,
   `chore`, `ci`, `docs`, `refactor`, `style` and `test` are only counted, unless they are
   breaking. There is no changelog file: the notes live in the tag, `git show vX.Y.Z` prints
   them.

The release before is the highest `v*` tag below the new version whose commit has a
`package.json` with the name `homebridge-fhemgate`. The repository also holds the `v0.5.x` tags of
homebridge-fhem, which name another package and do not count. Without a release before, the notes
start at the commit that gave the package its name, the rewrite. `--notes-from <ref>` starts them
after another commit or tag instead.

Look at the notes before pushing: until it is pushed, a release is undone with
`git tag -d vX.Y.Z` and `git reset --hard HEAD~1`.

### What the workflow does

On a pushed tag `v*`, `release.yml`

1. fails unless the tag is `v` and the version in the `package.json` of the tagged commit
   (`scripts/release-tag.ts`),
2. runs `bun run verify` on the tagged commit, with the end-to-end tests against the stand-in fhem,
3. publishes with `npm publish` through trusted publishing: no token, npm signs the provenance by
   itself. A prerelease goes to the dist-tag `next`, so that `npm install homebridge-fhemgate`
   never installs one, and a release to `latest`. A version that is on npm already is left as it
   is,
4. creates the GitHub release of the tag, with the message of the tag as its notes, marked as a
   prerelease for a prerelease.

To check a release: the run under Actions, `npm view homebridge-fhemgate dist-tags`, the
provenance on the npm page of the version, and the release on GitHub. If a step after the publish
failed, rerun the failed jobs of the run. A version npm has once published can not be published
again, not even after it was unpublished.

### A bad release

Do not unpublish it. Deprecate it with a reason, and release the fix as the next version:

```sh
npm deprecate homebridge-fhemgate@0.2.0 "breaks thermostats, use 0.2.1"
```

If it is the `latest` one and the fix takes longer, point `latest` back to the version before:
`npm dist-tag add homebridge-fhemgate@0.1.0 latest`. Both need an `npm login` with two-factor
authentication, as the trusted publisher may only publish.
