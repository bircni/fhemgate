// one directory for everything the homebridge processes of a run write. it is removed after
// the run, once the last of them has ended: a homebridge takes up to five seconds to end, and
// the tests do not wait for that.
import { existsSync, mkdtempSync, readdirSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { TestProject } from 'vitest/node';

declare module 'vitest' {
  export interface ProvidedContext {
    /** where the homebridge processes keep their storage directories */
    e2eDirectory: string;
  }
}

function isRunning(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

/** the homebridge processes of the run that have not ended yet, and whether a test asked them to stop */
function homebridges(directory: string): { pid: number; stopping: boolean }[] {
  return readdirSync(directory)
    .map((storage) => join(directory, storage))
    .filter((storage) => existsSync(join(storage, 'pid')))
    .map((storage) => ({ pid: Number(readFileSync(join(storage, 'pid'), 'utf8')), stopping: existsSync(join(storage, 'stopping')) }));
}

export default function setup(project: TestProject): () => Promise<void> {
  const directory = mkdtempSync(join(tmpdir(), 'fhemgate-e2e-'));
  project.provide('e2eDirectory', directory);

  return async () => {
    const left = homebridges(directory);
    // a test that failed before it stopped its homebridge leaves it running
    const abandoned = left.filter((homebridge) => !homebridge.stopping && isRunning(homebridge.pid));
    for (const { pid } of abandoned) {
      process.kill(pid, 'SIGTERM');
    }

    // homebridge ends itself five seconds after the signal at the latest. only then has node
    // written the coverage of the process, if that is being collected.
    const deadline = Date.now() + 15_000;
    while (left.some(({ pid }) => isRunning(pid)) && Date.now() < deadline) {
      await new Promise((resolve) => setTimeout(resolve, 100));
    }

    rmSync(directory, { recursive: true, force: true });
  };
}
