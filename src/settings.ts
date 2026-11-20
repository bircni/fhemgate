import { createRequire } from 'node:module';

/** The platform alias users put into the homebridge config.json. Kept from homebridge-fhem. */
export const PLATFORM_NAME = 'FHEM';

/** The name of this plugin as published. */
export const PLUGIN_NAME = 'homebridge-fhemgate';

/** the version of this plugin */
export const version = (createRequire(import.meta.url)('../package.json') as { version: string }).version;
