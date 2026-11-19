# Changelog

## Unreleased

Started from homebridge-fhem 0.5.55, including HomeMatic IP support through HMCCU.

- The package is now called `homebridge-fhem2hb`. The platform name in the homebridge config stays `FHEM`.
- Node 22, 24 and 26 and homebridge 1.8 or 2.x are required.
- Added an ISC `LICENSE` file. homebridge-fhem declared the licence only in its `package.json`.
- Removed `lib/fhem.js`, which the plugin did not load, and the unused `har-validator` and `ws` dependencies.
