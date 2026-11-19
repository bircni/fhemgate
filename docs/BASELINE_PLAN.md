# fhem2hb — maintained successor to homebridge-fhem

## Running this as a goal

This file is written to be executed autonomously. Step 1 of Phase 0 copies it into the repo as
`docs/BASELINE_PLAN.md`, so the goal survives context resets and has a place to tick off progress.

**Goal text to paste:**

> Execute the baseline plan in `/Users/nicolas/.claude/plans/curious-hopping-pixel.md`
> (copied to `docs/BASELINE_PLAN.md` in Phase 0) for the repo at
> `/Users/nicolas/Github/bircni/fhem2hb`, Phases 0 through 3, milestone by milestone, committing
> after each milestone and ticking it off in `docs/BASELINE_PLAN.md`. The goal is complete when
> `bun run verify` exits 0 on a clean checkout and every item in the "Definition of done" section
> holds. Stay inside the "Guardrails" section; if a guardrail blocks you, record it under
> "Blocked / needs owner" in `docs/BASELINE_PLAN.md` and continue with the next independent milestone.

**Definition of done** (all checkable locally, no human judgement needed):

1. `bun run verify` exits 0. It is created in M1 and chains: `bun install --frozen-lockfile` →
   `lint` (`--max-warnings=0`) → `typecheck` → `test -- --coverage` → `build` → `pack-smoke`.
2. `index.js`, `lib/`, and the legacy ESLint tier no longer exist; `git ls-files '*.js'` returns
   only config files.
3. `grep -rE "postman-request|har-validator" package.json bun.lock` returns nothing.
4. `pack-smoke` passes: the packed tarball installs with plain `npm install` into a temp dir and
   `import('homebridge-fhem2hb')` resolves on the local Node 26.
5. Coverage thresholds in `vitest.config.ts` (lines ≥ 80 %, set at the end of M2) are met.
6. Snapshot integrity: `git diff <tag baseline-m2>..HEAD -- test/**/__snapshots__` shows changes
   only in the transport suite, each explained in `docs/BASELINE_PLAN.md`.
7. `docs/KNOWN_BUGS.md` exists and every entry names the test that pins it.
8. `.github/workflows/ci.yml` exists and passes `actionlint` (run via `bunx`); every milestone
   below is ticked.
10. `bun run test:e2e` passes: Homebridge 2.x on the local Node 26 publishes the accessories of the
    stand-in fhem, a write reaches fhem and an event reaches HomeKit.
9. `git log --format='%ae%n%ce' | sort -u` contains only the public git identity already used on `main` (never the owner's private address), and no commit made
   during the goal carries a `Co-Authored-By` trailer.

**Guardrails** (hard limits for autonomous execution):

- **Never push.** No `git push` of any branch or tag to any remote, under any circumstances,
  until the owner explicitly lifts this. Enforced technically in M0: both source remotes get
  `git remote set-url --push <name> DISABLED`, and no `origin` remote is added. A green local
  `bun run verify` is the finish line; CI running on GitHub is not part of this goal.
- Local only otherwise too: no creating GitHub repos, no issues/PRs/comments, no `npm publish`
  / `bun publish`. `package.json` keeps `"private": true` for the whole baseline.
- Only read from the network for: `git fetch` of the two source repos, `bun install`, and
  read-only `gh api` calls. Nothing identifying the owner goes into outbound requests.
- Commits use the existing global git identity unchanged; never add AI co-author or
  assisted-by trailers; never write the owner's private e-mail anywhere.
- Never run `vitest -u` / update a snapshot during Phase 3 unless the milestone explicitly says
  so (M3.6 transport). A snapshot that changes is a regression to fix, not to accept.
- No fixes for anything in `KNOWN_BUGS.md` and no Phase 4 work, however tempting.
- Do not delete or rewrite imported upstream history (no rebase/force operations on `main`).
- Local Node is 26 only; Node 22/24 are covered by the CI matrix, which cannot run until a
  remote exists. Record that as a known unverified item rather than installing version managers.

**Milestones** (each = one or more commits on branch `baseline`, each ends green):

- [x] **M0** Phase 0 — import, licence, package identity, dead code removed
- [x] **M1** Phase 1 — bun, TypeScript, ESLint, Vitest, `verify` script, CI workflow, repo docs
- [x] **M2.1** test seam + real HAP types + ported harness and HMCCU suites
- [x] **M2.2** device fixtures for every detection branch
- [x] **M2.3** suites 1–6 and 8 (detection, services, to-HomeKit, to-FHEM, parser, colour, identity)
- [x] **M2.4** fake FHEMWEB + transport suite
- [x] **M2.5** `KNOWN_BUGS.md`, coverage threshold set, mutation spot-check done, tag `baseline-m2`
- [x] **M3.1** `util/*`, `mapping/types`, `mapping/parser`
- [x] **M3.2** `mapping/compile`, `mapping/toHomekit`, `mapping/toFhem`, `mapping/userFunctions`
- [x] **M3.3** `state/*`, `devices/identity`, `accessory/customCharacteristics`
- [x] **M3.4** `devices/detect` + `devices/rules/*`
- [x] **M3.5** `accessory/*` (accessory, services, history), `debug/server`
- [ ] **M3.6** `fhem/*` on native `fetch`, drop `postman-request` (transport snapshots may change)
- [ ] **M3.7** `platform`, `config`, `index.ts`; delete `index.js` and legacy lint tier; final verify
- [ ] **M3.8** end-to-end test (added by the owner on 2026-11-19, while M3.4 was in progress):
  a real Homebridge process loads the built plugin from `dist/`, configured against the stand-in
  FHEMWEB of the tests. The test reads the published accessories over HAP, writes a
  characteristic and checks the command that reaches fhem, and sends an event and checks the
  value HomeKit sees. Runs locally as `bun run test:e2e` and is part of `bun run verify` and of
  CI. In addition a CI-only job runs the same checks against a real fhem in a container
  (`ghcr.io/fhem/fhem-docker`) with a few dummy devices. That job can not be verified here:
  nothing is pushed and no container runtime is assumed locally, so it is checked with
  `actionlint` only and listed under "Blocked / needs owner" until CI has run once.

**Progress log:**

- Prepared before the goal started: repo initialised from `fork/hmccu-homematic-ip` (`a743dc4`,
  388 commits), `main` left at that commit, branch `baseline` created, push URLs of `upstream`
  and `fork` set to `DISABLED`, this file added. Legacy runner `node test/run.js`: 153 checks
  pass on Node 26. M0 continues at step 3 (LICENSE, package identity, dead code).
- M1 deviations from the text below: the package is `"type": "module"` from M1 on, so the
  legacy entry is `index.cjs` (was `index.js`), `lib/version.cjs` and the legacy tests are `.cjs`
  too. Wherever this plan says `index.js` it now means `index.cjs`. TypeScript is pinned to 6.x
  because typescript-eslint does not support TypeScript 7 yet. `tsconfig.json` type-checks
  everything without emitting, `tsconfig.build.json` builds `src` to `dist`. `pack-smoke` is
  `scripts/pack-smoke.ts`, run by Node directly. `actionlint` is run from the locally installed
  binary. CI on Node 22 and 24 is unverified: there is no remote and only Node 26 locally.
- M2 as built: the legacy file exports its internals as `__internals`, and every test reaches the
  code through `test/support/subject.ts` only, so Phase 3 re-points that one file. Tests run
  against the real HAP-NodeJS 2.3 classes. 179 device fixtures, synthesised from the detection
  code, run through five recorded checks each (`test/devices.test.ts`, 819 snapshots). The
  transport suite talks over real HTTP to a stand-in FHEMWEB on a random local port; no test
  touches a real fhem. `postman-request` does load on the local Node 26.10 with the versions bun
  resolved, so the legacy transport is tested as it is. Coverage of `index.cjs` at the tag
  `baseline-m2`: 93.6 % of lines; thresholds are 85 % lines and statements, 80 % functions,
  70 % branches. Mutation spot-check: making the HM dimmer read `state` failed 4 tests, rounding
  the value scaling down failed 14. The code no test reaches is listed at the end of
  `docs/KNOWN_BUGS.md`.

**Blocked / needs owner:** *(filled in during execution)*

---

## Context

`justme-1968/homebridge-fhem` (v0.5.55, 384 commits since 2015) is effectively unmaintained:
no tests, no lint, no CI, no LICENSE file, and it **does not load on Node 26** (upstream #127 —
a `postman-request` transitive dep reads the removed `SlowBuffer`; the failure publishes zero
accessories and HomeKit wipes rooms/scenes). We want a maintained successor in this (empty) repo.

Approach, confirmed by our own exploration and the external analysis: **rewrite the engine, keep
the knowledge.** The value is ~10 years of per-device quirks and the `homebridgeMapping` syntax,
which is a public interface. So we do not start from a blank file; we pin today's behaviour with
tests, then modularize and convert under that safety net.

This plan details the **baseline** (Phases 0–3): import, tooling, characterization tests,
modularization into TypeScript — with *no intended behaviour change* except the Node 26 fix.
Phase 4 (engine modernisation, bug fixes) is outlined as roadmap only and gets its
own plan later.

### What exploration established

- Live code is `index.js` only (3376 lines upstream). `lib/fhem.js` (2724 lines) is a dead,
  drifted alexa-fhem copy — its `require` is commented out at `index.js:21`. `ws` and
  `har-validator` are unused by the live code.
- Existing prior work: `bircni/homebridge-fhem` branch `hmccu-homematic-ip` = upstream master
  `80d5cc6` + 4 commits (HMCCU/HomeMatic IP support, 3 bug fixes, and a **vm-based test harness**
  in `test/helpers.js` + 3 test files, `node test/run.js`). `index.js` there is 3826 lines.
  This is the best starting point, and its harness is the seed for Phase 2.
- Structure of `index.js`: module globals (`FHEM_subscriptions`, `FHEM_cached`, `FHEM_longpoll`,
  `FHEM_csrfToken`, HAP types) · `FHEM_update`/`FHEM_reading2homekit(_)` value conversion ·
  `FHEM_startLongpoll`/`FHEM_execute` transport · colour maths · `FHEMPlatform` (static platform,
  3-arg `registerPlatform('homebridge-fhem','FHEM',…)`) · `FHEMAccessory` whose ~1000-line
  constructor does device detection → `fromHomebridgeMapping` → identity → mapping compilation ·
  `getServices` (~480 lines incl. fakegato/Eve history) · an unauthenticated debug HTTP server
  bound at module load on :8282.
- External analysis' bug claims verified in source: `for…in` over the Characteristic class for
  reverse constant lookup (`index.js:2151`, `:2185` — inherits EventEmitter statics, hence
  "means captureRejections"); `informId = device+'-'+mapping.reading` with undefined reading
  (`:2100`); `CurrentHeatingCoolingState = { default: 'HEAT' }` (`:1957`); per-event
  `…not handled in values` error log (`:414`). Plus ~20 more from our mapping (e.g. `ct2rgb`
  calls undefined `log` at `:976`, stray `;` at `:969`/`:1141`, `p === 'invert'` never true `:2469`).
- Security debt (fix in Phase 4, not baseline): `new Function` on FHEM attribute strings,
  unescaped command/Perl string building, `rejectUnauthorized:false`, csrf token in logs,
  open debug server.
- Target stack = official `homebridge-plugin-template`: TypeScript 6, ESM (`"type":"module"`),
  `module: nodenext`, target ES2022, ESLint 10 flat config + typescript-eslint, engines
  `node ^22.12 || ^24 || ^26`, `homebridge ^1.8 || ^2`.

### Decisions taken (defaults — say so if you want any changed)

| Topic | Decision | Why / tradeoff |
|---|---|---|
| Baseline source | Import full git history from `bircni/homebridge-fhem@hmccu-homematic-ip` | Keeps blame + attribution, includes your HMCCU work and tests, upstream fixes stay mergeable. Repo is visibly a fork. |
| Licence | ISC `LICENSE` file crediting justme1968 + contributors, plus our copyright line; SPDX `"license": "ISC"` | Matches the only grant upstream made; ISC requires keeping notice + permission text. |
| Compatibility | Drop-in: platform alias stays `FHEM`, same config keys, same `homebridgeMapping` / `genericDeviceType` semantics | Existing setups keep working. Cost: cannot be installed side-by-side with the old plugin. |
| Package name | `homebridge-fhem2hb` (free on npm; `homebridge-fhem2` is taken) | Homebridge requires the `homebridge-` prefix. |
| Toolchain | Tests first on untouched JS, then TypeScript ESM module by module; Vitest | Every extraction is verified against pinned behaviour; slower than big-bang but regressions are attributable to one commit. |
| Package manager | **Bun** for install, lockfile (`bun.lock`) and running scripts; no `package-lock.json` | Your preference; much faster installs. `package.json` itself stays, because Homebridge installs plugins from the npm registry — that is a packaging format, not a tool we use day to day. |
| Test runtime | Vitest executed **on Node** (started via `bun run test`), not `bun test` | The plugin runs inside Homebridge on Node; the bug that motivates this project is Node-26-specific and the transport relies on Node's `fetch`/stream behaviour. Testing on Bun's runtime would not prove any of that. Tradeoff: slightly slower than `bun test`. |
| Known bugs | Pinned as-is in snapshots during baseline, listed in `docs/KNOWN_BUGS.md`, fixed later one commit each | Keeps "refactor" and "behaviour change" diffs separate and reviewable. |

Standing rules for all work: nothing is pushed, published, or posted without explicit approval;
no private e-mail address in any commit/author field or file (verify `git config user.email`
before the first commit); no AI co-author trailers; commits are made per step on a feature
branch, not on the default branch.

---

## Phase 0 — Import & repo hygiene

1. `git init`, add remotes `upstream` (justme-1968) and `fork` (bircni/homebridge-fhem); fetch;
   create `main` from `fork/hmccu-homematic-ip`. Confirm `bun run test` (existing `node test/run.js`)
   passes on Node 26 — it should, since the harness never loads `postman-request`.
2. Work branch `baseline` (all goal commits land here; `main` stays at the imported state).
   Copy this plan to `docs/BASELINE_PLAN.md` as the first commit.
3. `LICENSE` (ISC text, "Copyright (c) 2015-2026 justme1968 and contributors", "Copyright (c) 2026
   <you>"), `package.json`: name `homebridge-fhem2hb`, version `0.6.0-alpha.0`, SPDX `license`,
   fixed `engines`, `repository` → new repo, `displayName`, keep keywords + `homebridge-plugin`.
4. README: short "successor of homebridge-fhem" header + attribution; rest unchanged for now.
5. Delete `lib/fhem.js` (dead). Inline `lib/version.js` later in Phase 3.
6. Remove unused deps `har-validator`, `ws`.

## Phase 1 — Tooling on the untouched code

- **TypeScript**: `tsconfig.json` from the template (`rootDir src`, `outDir dist`, strict,
  nodenext). `src/` starts empty except `index.ts` re-exporting the legacy entry (see Phase 3 seam).
- **ESLint 10 flat config** (`eslint.config.js`) with two tiers: template rules + typescript-eslint
  `strictTypeChecked` for `src/**`; a deliberately lenient legacy block for `index.js`
  (only real-error rules: `no-undef`, `no-unused-vars` as warn, `no-unreachable`, `no-empty`) so
  lint is green from day one and the legacy block shrinks to nothing as code moves.
  `bun run lint` = `eslint . --max-warnings=0` applies to `src/` and `test/`.
- **Vitest** + `@vitest/coverage-v8`; scripts `test`, `test:watch`, `coverage`, `build`, `lint`,
  `typecheck`, `prepublishOnly`.
- **Bun**: `bun install` generates `bun.lock` (committed); `packageManager` field set; all
  scripts invoked as `bun run <script>`. Scripts must not use Bun-only APIs, so the built
  `dist/` stays plain Node ESM.
- **CI is part of the baseline** — `.github/workflows/ci.yml`, on push + pull_request:
  - job `check`: `oven-sh/setup-bun` → `bun install --frozen-lockfile` → `bun run lint` →
    `bun run typecheck` → `bun run build`.
  - job `test`: matrix Node 22 / 24 / 26 (`actions/setup-node` + setup-bun for install) →
    `bun run test -- --coverage`; coverage summary uploaded as artifact, threshold enforced
    once Phase 2 sets it.
  - job `pack-smoke`: build, `bun pm pack`, install the tarball into a temp dir with plain
    `npm install` on Node 26 and `node -e "import('homebridge-fhem2hb')"` — proves the package
    is installable the way Homebridge installs it and loads on Node 26 (the #127 regression guard).
  - job `audit`: `bun audit` on production deps (non-blocking at first).
  - Actions pinned by commit SHA, `permissions: contents: read`, concurrency cancel-in-progress.
- `.github/dependabot.yml` (bun + github-actions ecosystems), PR template, issue templates
  (bug report asks for the `jsonlist2` of the device — doubles as fixture intake).
- `.editorconfig`, `.gitignore` (+`dist/`, `coverage/`), `files` allow-list in `package.json`,
  `CONTRIBUTING.md` (how to add a device fixture), `CHANGELOG.md`.
- No release/publish workflow in this plan.

## Phase 2 — Characterization tests (the safety net)

Goal: behaviour of `index.js` pinned tightly enough that Phase 3 can be purely mechanical.

- **Seam**: add one guarded export at the bottom of `index.js`
  (`module.exports.__internals = { FHEMAccessory, FHEMPlatform, FHEM_reading2homekit, … }`)
  instead of the vm-context loader. Rationale: same-realm objects, real V8 coverage numbers for
  `index.js`, and `import` works from Vitest. Tradeoff: a ~10-line edit to legacy code; the vm
  loader in `test/helpers.js` stays available as fallback.
- **Real HAP types, not stubs**: inject `Service`/`Characteristic` from the `homebridge`
  devDependency. The hand-written stubs in `test/helpers.js` cannot reproduce bugs that depend on
  the real class shape (the `for…in`/EventEmitter-statics one).
- Port `test/helpers.js` (`device()`, `accessoryFor()`, `command()`, log capture) to
  `test/support/*.ts`; port the three `hmccu-*` suites to Vitest unchanged in meaning.
- **Fixtures** `test/fixtures/devices/<family>/<name>.json` — jsonlist2 device objects. One per
  detection branch in the constructor (`index.js:1318–1957`): ZWave/HM/FS20 dimmers, HUE/WifiLight/
  Milight/SWAP colour, HM/MAX/PID20/Comet DECT thermostats, HM/DUOFERN/SOMFY/FS20 blinds, contact/
  window/lock sensors, PRESENCE/ROOMMATE/RESIDENTS, SONOS, harmony, temp/humidity/air-quality,
  HMCCU, dummy, each `genericDeviceType`. Synthesised from the code first; **real anonymised
  `jsonlist2` dumps from your FHEM replace/extend them** (tracked as an open item, not a blocker).
- **Suites** (snapshot-style, each fixture run through all of them):
  1. *detection*: fixture → `accessory.mappings` after constructor (serialised without functions).
  2. *services*: `getServices()` → service types/subtypes, characteristics, props, linked services.
  3. *reading → HomeKit*: table of raw values per mapping through `FHEM_reading2homekit`.
  4. *HomeKit → FHEM*: values through `accessory.command()` → exact command string.
  5. *homebridgeMapping parser*: DSL + JSON forms, `clear`, `Service(subtype)#Char`, `linkedTo`,
     copy-from-characteristic, `values`/`cmds`/`valid` lists, `+`→space.
  6. *colour maths*: `rgb2hsv`/`hsv2rgb`/`xyY2rgb`/`ct2rgb`/`rgb2hex` tables.
  7. *transport*: an in-process fake FHEMWEB (`node:http`: jsonlist2, `?cmd=`, csrf header,
     chunked `inform` stream) → long-poll line framing, cache/subscription updates, reconnect.
  8. *identity*: name/siriName/alias sanitising, serial + model per TYPE, resulting accessory UUID
     (must stay stable — HomeKit room assignments depend on it).
- `docs/KNOWN_BUGS.md`: every pinned-but-wrong behaviour with file:line and the test that pins it.
- Exit criterion: line coverage of `index.js` ≥ ~80 % outside the debug server; untested
  branches listed explicitly rather than silently ignored.

## Phase 3 — Modularize into TypeScript (no behaviour change)

Order = pure → stateful → IO, one module per commit, suites green after each. `index.js` shrinks
as functions move out and `require` them back from `dist/`; when it is empty it is deleted.

```
src/
  index.ts                registerPlatform(PLUGIN_NAME, PLATFORM_NAME, FhemPlatform)
  settings.ts             PLATFORM_NAME='FHEM', PLUGIN_NAME, defaults
  config.ts               typed config + validation (no process.exit)
  platform.ts             FhemPlatform: wiring only
  util/color.ts           rgb/hsv/xy/ct                       ← index.js:876–1066
  util/names.ts           sanitizeHapName                     ← :1262
  mapping/types.ts        Mapping, CompiledMapping interfaces
  mapping/parser.ts       homebridgeMapping DSL/JSON          ← fromHomebridgeMapping :2341–2495
  mapping/compile.ts      values/cmds/valid tables, eventMap  ← constructor :2084–2302
  mapping/toHomekit.ts    reading → HomeKit pipeline          ← FHEM_reading2homekit(_) :218–553
  mapping/toFhem.ts       HomeKit → `set` command             ← command :2519–2640
  mapping/userFunctions.ts  jsFunctions + inline JS hooks (isolated on purpose)
  devices/types.ts        Jsonlist2Device
  devices/detect.ts       ordered rule runner
  devices/rules/*.ts      lights, dimmers, color, thermostats, blinds, sensors, presence,
                          media, hmccu, generic               ← constructor :1318–1957
  devices/identity.ts     name, model, serial, uuid base      ← :2026–2080
  fhem/protocol.ts        pure: URL building, inform-line parsing
  fhem/client.ts          execute, jsonlist2, csrf            ← FHEM_execute, accessories()
  fhem/eventStream.ts     long-poll + backoff                 ← FHEM_startLongpoll :559–795
  state/readingCache.ts   ← FHEM_cached
  state/subscriptions.ts  ← FHEM_subscribe/unsubscribe/isPublished/update
  accessory/accessory.ts  FhemAccessory: query, delayed, subscribe
  accessory/services.ts   getServices body                    ← :2821–3298
  accessory/customCharacteristics.ts  CustomUUIDs + Eve UUIDs ← :1240–1259 + inline
  accessory/history.ts    fakegato / Eve TimesOpened etc.
  debug/server.ts         debug HTTP server (still started as today; made opt-in in Phase 4)
```

Rules for this phase:
- **Move, don't improve.** Logic is transcribed; `var`→`const/let`, typed signatures, and
  `any`-free interfaces are allowed, algorithm changes are not. Bugs travel with the code and
  stay in `KNOWN_BUGS.md`.
- Module globals become classes/objects **constructed once in `platform.ts` and passed in**
  (`ReadingCache`, `Subscriptions`, HAP handle). Behaviour is identical for a single platform;
  it removes the cross-instance sharing as a side effect — noted, and covered by a two-platform test.
- Device detection is split into `rules/*.ts` as ordered functions first (exact same evaluation
  order as the constructor). Turning them into declarative data tables is Phase 4 — doing both at
  once would make a detection regression impossible to localise.
- **The one intended behaviour change**: replace `postman-request` with native `fetch`
  (streaming body for long-poll, Basic auth header, gzip built in) in `fhem/client.ts` +
  `fhem/eventStream.ts`. This fixes Node 26 and removes the whole deprecated dep tree. Tradeoffs:
  digest auth (possible via `sendImmediately:false` today) is dropped — FHEMWEB only offers
  Basic; and `rejectUnauthorized:false` must be reproduced via an `undici` `Agent` so self-signed
  setups keep working until Phase 4 makes it an explicit option. Covered by the fake-FHEMWEB suite.
- Module-level unit tests are added next to each extracted module (`*.test.ts`); the Phase 2
  fixture suites stay as the end-to-end guard and are re-pointed from `__internals` to `src/`.
- Exit criterion: no `index.js`, no legacy ESLint tier, `tsc --noEmit` strict clean, all Phase 2
  snapshots byte-identical to their Phase 2 state except the transport ones touched by `fetch`.

---

## Roadmap after the baseline (separate plans)

**Phase 4 — engine modernisation & fixes**, each item its own PR with snapshot diffs:
- Dynamic platform with cached accessories (`configureAccessory`), keeping accessory UUIDs
  identical to the static ones; **never unregister accessories when FHEM is unreachable**.
- `onGet`/`onSet`, `updateValue`, drop `Characteristic.Reachable`.
- Detection rules → data tables; work through `KNOWN_BUGS.md` and upstream issues
  (#120 status updates under HB2, #108/#73 cache, blinds/thermostat/colour bugs, log noise #93/#106).
- Security: escape/encode command building, TLS verification on by default with an explicit
  opt-out, stop logging csrf tokens, debug server opt-in + localhost only, document and gate
  inline-JS mappings. Each with a regression test that fails before the fix.
- Optional: websocket transport, multi-server isolation, config UI schema (fix `port` default
  type, mislabelled auth fields, add `webname`/`jsFunctions`/`scope`).

Releasing/publishing is deliberately out of scope until you ask for it; the package stays at
`0.6.0-alpha.0` and `"private": true` is set in `package.json` during the baseline so nothing
can be published by accident.

## Open items (non-blocking)

- Real, anonymised `jsonlist2` dumps from your FHEM for the device families you own.
- Whether to open an upstream issue asking for a LICENSE file (I would draft it; posting needs
  your approval).
- GitHub remote for this repo (`bircni/fhem2hb`?) — created/pushed only when you say so.

## Verification

- Phase 0: `bun run test` (legacy runner) green on Node 26; `git log` shows upstream history;
  `git log --format='%ae' | sort -u` contains no private address from new commits.
- Phase 1: `bun run lint && bun run typecheck && bun run test && bun run build` green locally;
  CI matrix green once a remote exists.
- Phase 2: `bun run coverage` report for `index.js`; mutation spot-check — deliberately break one
  detection branch and one value transform, confirm a snapshot fails, revert.
- Phase 3: after every extraction commit `bun run test` with **zero snapshot updates**; final
  end-to-end: `bun run build`, then `npm link` into a local Homebridge 2.x on Node 26 pointed at a real FHEM (or the
  fake FHEMWEB server from the test support dir), confirm accessories appear with the same names/
  UUIDs as under `homebridge-fhem`, a switch toggles in both directions, and long-poll survives
  an FHEM restart.
