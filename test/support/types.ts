// the shapes the tests work with. they describe the plugin as it is today: an accessory per
// fhem device, holding one mapping per homekit characteristic.
import type { Characteristic, Service } from '@homebridge/hap-nodejs';

/** a device as fhem's jsonlist2 reports it */
export interface FhemDevice {
  Name?: string;
  Internals: Record<string, string | undefined> & { NAME: string; TYPE: string };
  Readings: Record<string, { Value: string; Time?: string } | undefined>;
  Attributes: Record<string, string | undefined>;
  PossibleSets: string;
  PossibleAttrs: string;
}

export type Converter = (value: unknown) => unknown;

export interface Mapping {
  reading?: string;
  device?: string;
  cmd?: string;
  cmdOn?: string;
  cmdOff?: string;
  informId?: string;
  characteristic_type?: string;
  characteristic?: unknown;
  cached?: unknown;
  default?: unknown;
  name?: string;
  subtype?: string;
  delay?: number | boolean;
  timeout?: number;
  nocache?: unknown;
  last_update?: number;
  reading2homekit?: Converter | string;
  homekit2reading?: Converter | string;
  log?: unknown;
  [key: string]: unknown;
}

export type QueryCallback = (error?: unknown, value?: unknown) => void;

export interface Accessory {
  mappings: Record<string, Mapping | Mapping[] | undefined>;
  service_name?: string;
  name?: string;
  alias?: string;
  siriName?: string;
  device?: string;
  type?: string;
  model?: string;
  serial?: string;
  uuid_base?: string;
  fuuid?: string;
  room?: string;
  category?: number;
  displayName?: string;
  fhem?: unknown;
  historyService?: unknown;
  delayed_timers?: Record<string, unknown>;

  fromHomebridgeMapping(homebridgeMapping: string | undefined): void;
  command(mapping: Mapping | string, value?: unknown): void;
  delayed(mapping: Mapping, value: unknown, delay?: number | boolean): void;
  query(mapping: Mapping | string, callback?: QueryCallback): unknown;
  execute(cmd: string, callback?: (result: string) => void): void;
  identify(callback: () => void): void;
  subscribe(mapping: Mapping | string, characteristic?: Characteristic): void;
  unsubscribe(mapping?: Mapping | string, characteristic?: Characteristic): void;
  isInRoom(room: string | undefined): boolean;
  isOfType(type: string | undefined): boolean;
  isInScope(scope: string): boolean;
  serviceOfName(serviceName: string, subtype?: string): Service | undefined;
  characteristicOfName(name: string): unknown;
  createDeviceService(serviceName: string | undefined, subtype?: string): Service;
  getServices(): Service[];
}

export interface PlatformConfig {
  platform?: string;
  name?: string;
  server?: string;
  port?: number | string;
  filter?: string;
  ssl?: unknown;
  webname?: string;
  jsFunctions?: string;
  scope?: unknown;
  neverTimeout?: boolean;
  auth?: { user: string; pass: string; sendImmediately?: boolean };
}

export interface Platform {
  log: unknown;
  config: PlatformConfig;
  connection?: { base_url: string; dead?: boolean };
  server?: string;
  port?: number | string;
  filter?: string;
  scope?: unknown;
  jsFunctions?: unknown;
  siri_device?: string;
  accessories(callback: (accessories: Accessory[]) => void): void;
  execute(cmd: string, callback?: (result: string) => void): void;
  checkAndSetGenericDeviceType(): void;
  shutdown(): void;
}

export interface Subscription {
  accessory: Accessory;
  characteristic?: Characteristic;
  mapping?: Mapping;
}
