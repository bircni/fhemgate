/** a device as fhem's jsonlist2 reports it */
export interface Jsonlist2Device {
  Name?: string;
  Internals: Record<string, string | undefined> & { NAME: string; TYPE: string };
  Readings: Record<string, { Value: string; Time?: string } | undefined>;
  Attributes: Record<string, string | undefined>;
  /** the set commands of the device, separated by blanks, each optionally followed by `:<widget>,<values>` */
  PossibleSets: string;
  PossibleAttrs: string;
}
