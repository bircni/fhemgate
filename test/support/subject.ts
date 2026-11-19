// the one place that knows where the code under test lives. every test goes through this
// file, so the same tests keep running while the code moves from index.cjs into src/.
import * as hap from '@homebridge/hap-nodejs';
import * as legacy from '../../src/legacy.ts';
import type { PluginState } from '../../src/state/pluginState.ts';
import { createLog, type CapturedLog } from './log.ts';
import type { Accessory, FhemDevice, Mapping, Platform, PlatformConfig, Subscription } from './types.ts';

type Executor = (cmd: string, callback?: (result: string) => void) => void;

interface Internals {
  /** takes the hap classes and starts with an empty state, which is returned */
  useHap: (api: unknown) => PluginState;
  useUser: (user: { storagePath(): string }) => void;
  useFakeGato: (service: unknown) => void;

  FHEMPlatform: (new (log: CapturedLog, config: PlatformConfig, api: unknown) => Platform) & { prototype: unknown };
  FHEMAccessory: (new (platform: unknown, device: FhemDevice) => Accessory) & { prototype: { execute: Executor } };

  FHEM_longpoll: Record<string, Record<string, unknown> | undefined>;
  FHEM_csrfToken: Record<string, string | undefined>;
  FHEM_platforms: Platform[];

  FHEM_isPublished: (device: string) => Accessory | null;
  FHEM_update: (informId: string, value: unknown, noUpdate?: boolean) => void;
  FHEM_reading2homekit: (mapping: Mapping, value: unknown) => unknown;

  FHEM_sortByKey: <T>(array: T[], key: string) => T[];
  FHEM_rgb2hex: (r: number | number[], g?: number, b?: number) => string;
  FHEM_hsv2rgb: (h: number, s: number, v: number) => string;
  FHEM_ct2rgb: (ct: number | string) => string;
  FHEM_xyY2rgb: (x: number | string, y: number | string, Y: number) => string;
  FHEM_rgb2hsv: (r?: number | string, g?: number, b?: number) => [number | undefined, number, number] | undefined;

  CustomUUIDs: Record<'xVolume' | 'CT' | 'Volume' | 'Voltage' | 'Current' | 'Power' | 'Energy' | 'AirPressure' | 'Actuation', string>;
  sanitizeHapName: (name: string | number | null | undefined) => string;

  FHEM_hmccuReadings: (device: FhemDevice, datapoint: string) => string[];
  FHEM_hmccuChannel: (device: FhemDevice, datapoint: string) => string | undefined;
  FHEM_hmccuReading: (device: FhemDevice, datapoint: string) => string | undefined;
  FHEM_hmccuDatapoint: (device: FhemDevice, reading: string | undefined, datapoint: string) => string;
  FHEM_hmccuScalesLevel: (device: FhemDevice) => boolean;
  FHEM_hmccuMappings: (accessory: Pick<Accessory, 'mappings' | 'service_name'> & { log: CapturedLog }, device: FhemDevice, genericType?: string) => boolean;

  FHEMdebug_handleRequest: (request: { url: string }, response: { write(chunk: string): void; end(chunk: string): void }) => void;
}

const internals = legacy.__internals as unknown as Internals;
const plugin = legacy.default as (homebridge: unknown) => void;
internals.useHap(hap);

export { hap };

/** the function homebridge calls to load the plugin */
export const initializer: (homebridge: unknown) => void = plugin;

export const customUUIDs = internals.CustomUUIDs;
export const sanitizeHapName = internals.sanitizeHapName;
export const sortByKey = internals.FHEM_sortByKey;

export const color = {
  rgb2hex: internals.FHEM_rgb2hex,
  hsv2rgb: internals.FHEM_hsv2rgb,
  ct2rgb: internals.FHEM_ct2rgb,
  xyY2rgb: internals.FHEM_xyY2rgb,
  rgb2hsv: internals.FHEM_rgb2hsv,
};

export const hmccu = {
  readings: internals.FHEM_hmccuReadings,
  channel: internals.FHEM_hmccuChannel,
  reading: internals.FHEM_hmccuReading,
  datapoint: internals.FHEM_hmccuDatapoint,
  scalesLevel: internals.FHEM_hmccuScalesLevel,
};

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
  /** runs only the HMCCU detection */
  hmccuMappings(device: FhemDevice, genericType?: string): { handled: boolean; accessory: Pick<Accessory, 'mappings' | 'service_name'> };
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

const realExecute = internals.FHEMAccessory.prototype.execute;

/** starts from an empty plugin state. there is only one state at a time. */
export function createWorld(options: WorldOptions = {}): World {
  const state = internals.useHap(hap);
  internals.FHEM_platforms.length = 0;
  // the state of the connections stays: it is kept per url, and a connection that is still
  // open from an earlier test would fail without it

  internals.useUser({ storagePath: () => options.storagePath ?? '/nonexistent' });
  internals.useFakeGato(options.fakeGato);

  const log = createLog();
  const sent: string[] = [];

  // commands are recorded where the accessory hands them over to be sent
  internals.FHEMAccessory.prototype.execute = function (cmd, callback) {
    sent.push(cmd);
    const result = options.respond?.(cmd);
    if (result !== undefined && callback) {
      callback(result);
    }
  };

  return {
    log,
    sent,

    accessory(device, platform = {}) {
      return new internals.FHEMAccessory({ log, connection: {}, jsFunctions: options.jsFunctions, ...platform }, device);
    },

    hmccuMappings(device, genericType) {
      const accessory = { log, mappings: {}, service_name: genericType };
      const handled = internals.FHEM_hmccuMappings(accessory, device, genericType);
      return { handled, accessory };
    },

    platform(config, api = {}) {
      internals.FHEMAccessory.prototype.execute = realExecute;
      return new internals.FHEMPlatform(log, config, { hap, on: () => undefined, ...api });
    },

    update: internals.FHEM_update,
    toHomekit: internals.FHEM_reading2homekit,
    published: internals.FHEM_isPublished,

    cached: state.cache.values,
    subscriptions: state.subscriptions.byInformId as Record<string, Subscription[] | undefined>,
    longpoll: internals.FHEM_longpoll,
    csrfToken: internals.FHEM_csrfToken,

    shutdown() {
      (internals.FHEMPlatform.prototype as Platform).shutdown.call({ log });
    },

    debugPage(url) {
      let page = '';
      internals.FHEMdebug_handleRequest({ url }, {
        write: (chunk) => {
          page += chunk;
        },
        end: (chunk) => {
          page += chunk;
        },
      });
      return page;
    },
  };
}
