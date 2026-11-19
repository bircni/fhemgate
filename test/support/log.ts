// a homebridge logger that keeps what was logged. debug output is left out: it prints
// whole objects and says nothing a user of the plugin sees at the default log level.
export interface CapturedLog {
  (message: unknown): void;
  info(message: unknown): void;
  warn(message: unknown): void;
  error(message: unknown): void;
  debug(message: unknown): void;
  /** everything logged so far, one entry per call, prefixed with the level */
  lines: string[];
  /** only the lines logged as error */
  errors(): string[];
  clear(): void;
}

export function createLog(): CapturedLog {
  const lines: string[] = [];
  const add = (level: string) => (message: unknown) => {
    lines.push(`${level} ${String(message)}`);
  };

  return Object.assign(add('log'), {
    info: add('info'),
    warn: add('warn'),
    error: add('error'),
    debug: () => undefined,
    lines,
    errors: () => lines.filter((line) => line.startsWith('error ')),
    clear: () => {
      lines.length = 0;
    },
  });
}
