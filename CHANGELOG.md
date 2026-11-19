# Changelog

## Unreleased

Started from homebridge-fhem 0.5.55, including HomeMatic IP support through HMCCU.

- The package is now called `homebridge-fhem2hb`. The platform name in the homebridge config stays `FHEM`.
- Node 22, 24 and 26 and homebridge 1.8 or 2.x are required.
- Added an ISC `LICENSE` file. homebridge-fhem declared the licence only in its `package.json`.
- Removed `lib/fhem.js`, which the plugin did not load, and the unused `har-validator` and `ws` dependencies.
- The code is TypeScript in `src/`, split into modules, with tests that record what the plugin does for 179 device fixtures.
- fhem is reached with the http modules of Node. `postman-request`, which pulled in packages with known advisories, is gone.
  User and password are now sent with every request instead of only after FHEMWEB asked for them, and digest authentication is no longer possible.
- The debug server starts when homebridge loads the plugin, as before, and no longer when the file is merely imported.
