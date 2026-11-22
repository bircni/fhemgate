import { createRequire } from 'node:module';
import { join } from 'node:path';
import type { API, Logging } from 'homebridge';
import type { HistoryServiceClass } from './accessory/history.ts';
import type { FhemPlatformConfig } from './config.ts';
import { installationWarnings } from './migration.ts';
import { FhemPlatform, version, type Plugin } from './platform.ts';
import { PLATFORM_NAME, PLUGIN_NAME } from './settings.ts';
import { PluginState } from './state/pluginState.ts';

const require = createRequire(import.meta.url);

/**
 * The class of fakegato-history for the Eve history, or none when it is not installed or fails
 * to load. The plugin then runs without the history: an error that reaches homebridge here keeps
 * the plugin from loading, and with it every accessory.
 *
 * @param load loads a module, as `require` does
 */
export function loadHistoryService(homebridge: API, load: (id: string) => unknown = require): HistoryServiceClass | undefined {
  try {
    return (load('fakegato-history') as (homebridge: API) => HistoryServiceClass)(homebridge);
  } catch (e) {
    if ((e as { code?: string }).code === 'MODULE_NOT_FOUND') {
      console.log('error: fakegato-history not installed');
    } else {
      console.error(PLUGIN_NAME + ': fakegato-history failed to load, the plugin runs without the Eve history: ' + String(e));
    }
    return undefined;
  }
}

/**
 * The state of the plugin for a homebridge, and a platform class that is bound to it.
 * Loads fakegato-history for the Eve history if it is installed.
 *
 * @param load loads a module, as `require` does
 */
export function createPlugin(
  homebridge: API,
  load?: (id: string) => unknown,
): Plugin & { Platform: new (log: Logging, config: FhemPlatformConfig, api: API) => FhemPlatform } {
  const state = new PluginState(homebridge.hap);
  state.historyServiceClass = loadHistoryService(homebridge, load);

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

  homebridge.registerPlatform(PLATFORM_NAME, plugin.Platform);
}
