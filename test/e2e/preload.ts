// loaded into the homebridge of an end-to-end test before anything else.
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

// a homebridge outlives the test run that started it when that run is killed. it would go on
// asking for its fhem on a port that the stand-in of a later run may have by then, so it ends
// once the process that started it is gone.
const parent = process.ppid;
setInterval(() => {
  if (process.ppid !== parent) {
    process.kill(process.pid, 'SIGTERM');
  }
}, 1000).unref();

// the clock is left alone until the test moves it on, so that a test of what happens once a
// minute is over does not have to wait for the minute to pass. the test writes how far the clock
// is ahead into the file `clock` in the storage directory of homebridge and sends SIGUSR2. the
// line in the log tells it that homebridge took it.
const RealDate = Date;
let ahead = 0;

class MovedDate extends RealDate {
  constructor(...args: [] | [string | number | Date] | [number, number, number?, number?, number?, number?, number?]) {
    if (args.length === 0) {
      super(RealDate.now() + ahead);
    } else {
      // @ts-expect-error: Date takes each of these argument lists, but not a spread of their union
      super(...args);
    }
  }

  static override now(): number {
    return RealDate.now() + ahead;
  }
}

globalThis.Date = MovedDate as DateConstructor;

process.on('SIGUSR2', () => {
  const storage = process.argv[process.argv.indexOf('-U') + 1] ?? '';
  ahead = Number(readFileSync(join(storage, 'clock'), 'utf8'));
  console.log(`e2e clock is ${ahead} ms ahead`);
});
