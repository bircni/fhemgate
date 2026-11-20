import { createRequire } from 'node:module';
import { join } from 'node:path';
import type { API, Logging } from 'homebridge';
import type { HistoryServiceClass } from './accessory/history.ts';
import type { FhemPlatformConfig } from './config.ts';
import { installationWarnings, OLD_PLUGIN_NAME } from './migration.ts';
import { FhemPlatform, version, type Plugin } from './platform.ts';
import { PLATFORM_NAME, PLUGIN_NAME } from './settings.ts';
import { PluginState } from './state/pluginState.ts';

const require = createRequire(import.meta.url);

/**
 * The state of the plugin for a homebridge, and a platform class that is bound to it.
 * Loads fakegato-history for the Eve history if it is installed.
 */
export function createPlugin(homebridge: API): Plugin & { Platform: new (log: Logging, config: FhemPlatformConfig, api: API) => FhemPlatform } {
  const state = new PluginState(homebridge.hap);

  try {
    state.historyServiceClass = (require('fakegato-history') as (homebridge: API) => HistoryServiceClass)(homebridge);
  } catch (e) {
    if ((e as { code?: string }).code !== 'MODULE_NOT_FOUND') {
      throw e;
    }

    console.log('error: fakegato-history not installed');
  }

  const plugin: Plugin = { state, storagePath: () => homebridge.user.storagePath(), debugServers: new Map() };

  return {
    ...plugin,
    Platform: class extends FhemPlatform {
      constructor(log: Logging, config: FhemPlatformConfig, api: API) {
        super(log, config, api, plugin);
      }
    },
  };
}

/** homebridge calls this once when it loads the plugin */
export default function (homebridge: API): void {
  console.log('homebridge API version: ' + homebridge.version);
  console.info('this is ' + PLUGIN_NAME + ' ' + version);

  // homebridge hands a plugin no logger at this point, and it may never create a platform of it
  try {
    for (const warning of installationWarnings(join(import.meta.dirname, '..'), homebridge.user.configPath())) {
      console.warn(PLUGIN_NAME + ': ' + warning);
    }
  } catch {
    // the look around is a courtesy. it must not keep the plugin from loading.
  }

  const plugin = createPlugin(homebridge);

  // Registered under the name of homebridge-fhem. homebridge takes a plugin that names another
  // plugin here for one that got its own name wrong and notes that the name stands for it, so a
  // config entry that says "platform": "homebridge-fhem.FHEM" is loaded from this plugin. Such an
  // entry can not be renamed: homebridge makes the uuid of every accessory from what it says.
  // "FHEM" and "homebridge-fhem2hb.FHEM" are found as they are without it.
  homebridge.registerPlatform(OLD_PLUGIN_NAME, PLATFORM_NAME, plugin.Platform);
}
