// the one place that knows where the code under test lives. every test goes through this
// file, so the same tests kept running while the code moved out of the file taken over from
// homebridge-fhem into the modules under src/.
import * as hap from '@homebridge/hap-nodejs';
import type { API, Logging } from 'homebridge';
import { FhemAccessory, type AccessoryPlatform } from '../../src/accessory/accessory.ts';
import { CustomUUIDs } from '../../src/accessory/customCharacteristics.ts';
import type { HistoryServiceClass } from '../../src/accessory/history.ts';
import type { FhemPlatformConfig } from '../../src/config.ts';
import { handleDebugRequest } from '../../src/debug/server.ts';
import pluginInitializer from '../../src/index.ts';
import { reading2homekit } from '../../src/mapping/toHomekit.ts';
import type { PreparedMapping } from '../../src/mapping/types.ts';
import { FhemPlatform, sortByKey as sortListByKey, type Plugin } from '../../src/platform.ts';
import { PluginState } from '../../src/state/pluginState.ts';
import { ct2rgb, hsv2rgb, rgb2hex, rgb2hsv, xyY2rgb } from '../../src/util/color.ts';
import { sanitizeHapName as sanitize } from '../../src/util/names.ts';
import { createLog, type CapturedLog } from './log.ts';
import type { Accessory, FhemDevice, Mapping, Platform, PlatformConfig, Subscription } from './types.ts';

export { hap };

/** the function homebridge calls to load the plugin */
export const initializer = pluginInitializer as (homebridge: unknown) => void;

export const customUUIDs = CustomUUIDs;
export const sanitizeHapName = sanitize;
export const sortByKey = sortListByKey as <T>(array: T[], key: string) => T[];

export const color = { rgb2hex, hsv2rgb, ct2rgb, xyY2rgb, rgb2hsv };

export interface WorldOptions {
  /** functions a homebridgeMapping can refer to by name, as loaded from the jsFunctions file */
  jsFunctions?: Record<string, unknown>;
  /** answers the fhem commands the plugin sends. without it they are only recorded. */
  respond?: (cmd: string) => string | undefined;
  /** the homebridge storage directory */
  storagePath?: string;
  /** the fakegato-history service class, or undefined as if it was not installed */
  fakeGato?: unknown;
}

/** the state of one running plugin: what it cached, who listens, and what it sent to fhem */
export interface World {
  log: CapturedLog;
  /** the fhem commands sent so far */
  sent: string[];

  /** creates the accessory for a device, as the platform does for every device fhem reports */
  accessory(device: FhemDevice, platform?: Record<string, unknown>): Accessory;
  /** creates a platform. it connects to fhem right away. */
  platform(config: PlatformConfig, api?: Record<string, unknown>): Platform;

  /** a reading changed in fhem */
  update(informId: string, value: unknown, noUpdate?: boolean): void;
  /** converts a reading to the value of the characteristic of the mapping */
  toHomekit(mapping: Mapping, value: unknown): unknown;
  /** the accessory that is published for the device */
  published(device: string): Accessory | null;

  cached: Record<string, unknown>;
  subscriptions: Record<string, Subscription[] | undefined>;
  longpoll: Record<string, Record<string, unknown> | undefined>;
  csrfToken: Record<string, string | undefined>;

  /** homebridge is shutting down */
  shutdown(): void;

  /** the debug page of the plugin for the url */
  debugPage(url: string): string;
}

// eslint-disable-next-line @typescript-eslint/unbound-method -- kept to put it back
const realExecute = FhemAccessory.prototype.execute;

/** starts from an empty plugin state */
export function createWorld(options: WorldOptions = {}): World {
  const state = new PluginState(hap);
  state.historyServiceClass = options.fakeGato as HistoryServiceClass | undefined;
  const plugin: Plugin = { state, storagePath: () => options.storagePath ?? '/nonexistent' };

  const log = createLog();
  const logging = log as unknown as Logging;
  const sent: string[] = [];

  // commands are recorded where the accessory hands them over to be sent
  FhemAccessory.prototype.execute = function (cmd, callback) {
    sent.push(cmd);
    const result = options.respond?.(cmd);
    if (result !== undefined && callback) {
      callback(result);
    }
  };

  const api = (extra: Record<string, unknown>) => ({ hap, on: () => undefined, ...extra }) as unknown as API;

  return {
    log,
    sent,

    accessory(device, platform = {}) {
      const from = { log: logging, connection: {}, jsFunctions: options.jsFunctions, ...platform } as AccessoryPlatform;
      return new FhemAccessory(from, device, state, () => undefined) as unknown as Accessory;
    },

    platform(config, extra = {}) {
      FhemAccessory.prototype.execute = realExecute;
      // the tests also hand in what a config.json could wrongly contain
      return new FhemPlatform(logging, { platform: 'FHEM', ...config } as FhemPlatformConfig, api(extra), plugin) as unknown as Platform;
    },

    update: (informId, value, noUpdate) => {
      state.update(informId, value, noUpdate);
    },
    toHomekit: (mapping, value) => reading2homekit(mapping as PreparedMapping, value),
    published: (device) => state.subscriptions.publishedAccessory(device) as Accessory | null,

    cached: state.cache.values,
    subscriptions: state.subscriptions.byInformId as Record<string, Subscription[] | undefined>,
    longpoll: state.longpoll as Record<string, Record<string, unknown> | undefined>,
    csrfToken: state.csrfToken,

    shutdown() {
      // any platform does: they all save the histories of the one state
      new FhemPlatform(createLog() as unknown as Logging, { platform: 'FHEM' }, api({}), plugin).shutdown();
    },

    debugPage(url) {
      let page = '';
      handleDebugRequest(
        { url },
        {
          write: (chunk) => {
            page += chunk;
          },
          end: (chunk) => {
            page += chunk;
          },
        },
        state,
        state.longpoll,
      );
      return page;
    },
  };
}
