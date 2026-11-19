/**
 * The last value of every reading the plugin has seen, by `<device>-<reading>`, as fhem reported
 * it. Besides readings it holds values the plugin derives: hue, saturation and brightness of a
 * colour as `<device>-h`, `-s` and `-v`, and the counters of the Eve history.
 */
export class ReadingCache {
  readonly values: Record<string, unknown> = {};

  get(informId: string): unknown {
    return this.values[informId];
  }

  set(informId: string, value: unknown): void {
    this.values[informId] = value;
  }
}
