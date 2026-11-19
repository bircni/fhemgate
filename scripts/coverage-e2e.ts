// runs the end-to-end tests and reports which lines of src/ the homebridge processes ran.
//
// the plugin runs inside homebridge, a process of its own, so the coverage of vitest does not
// see it. node writes what a process ran when NODE_V8_COVERAGE names a directory. that is asked
// of every homebridge the tests start, and read here: per line of the files in dist/, and
// through their source maps per line of src/.
//
// a line of src/ counts when the compiled file has code for it. it is covered when one of the
// homebridge processes ran that code, or a part of it.
//
// arguments are handed on to vitest, so `bun run coverage:e2e test/e2e/scenarios.e2e.ts` reports
// what that one file covers.
import { spawnSync } from 'node:child_process';
import { existsSync, mkdtempSync, readdirSync, readFileSync, rmSync } from 'node:fs';
import { SourceMap, type SourceMapPayload } from 'node:module';
import { tmpdir } from 'node:os';
import { dirname, join, relative, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

const root = join(import.meta.dirname, '..');
const dist = join(root, 'dist');

/** what node writes for one script of a process */
interface ScriptCoverage {
  url: string;
  functions: { ranges: { startOffset: number; endOffset: number; count: number }[] }[];
}

interface Line {
  /** where the code of the line starts and ends in the file, without the blanks around it */
  start: number;
  end: number;
  /** the column the code starts in */
  column: number;
  /** the number of characters of the line */
  length: number;
  /** nothing but blanks or a comment */
  empty: boolean;
}

function files(directory: string, ending: string): string[] {
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const path = join(directory, entry.name);
    if (entry.isDirectory()) {
      return files(path, ending);
    }
    return entry.name.endsWith(ending) ? [path] : [];
  });
}

/** the lines of a compiled file. comments are told from code by how a line starts, which is enough for what tsc writes. */
function linesOf(source: string): Line[] {
  const lines: Line[] = [];
  let offset = 0;
  let inComment = false;
  for (const text of source.split('\n')) {
    const trimmed = text.trim();
    const column = text.length - text.trimStart().length;
    const start = offset + column;
    let empty = trimmed === '';
    if (inComment) {
      empty = true;
      inComment = !trimmed.includes('*/');
    } else if (trimmed.startsWith('//')) {
      empty = true;
    } else if (trimmed.startsWith('/*')) {
      empty = true;
      inComment = !trimmed.includes('*/');
    }
    lines.push({ start, end: start + trimmed.length, column, length: text.length, empty });
    offset += text.length + 1;
  }
  return lines;
}

/** for every line whether the process ran it: the count of the innermost block that holds the whole line */
function ranLines(lines: Line[], script: ScriptCoverage): boolean[] {
  const blocks = script.functions.flatMap((covered) => covered.ranges).sort((a, b) => a.startOffset - b.startOffset || b.endOffset - a.endOffset);
  const counts = lines.map(() => 0);
  for (const range of blocks) {
    lines.forEach((line, index) => {
      if (range.startOffset <= line.start && line.end <= range.endOffset) {
        counts[index] = range.count;
      }
    });
  }
  return counts.map((count) => count > 0);
}

interface FileCoverage {
  /** the path of the source file, from the root of the project */
  file: string;
  /** the lines of the source file there is code for, and whether it ran */
  lines: Map<number, boolean>;
}

function coverageOf(compiled: string, scripts: ScriptCoverage[]): FileCoverage {
  const lines = linesOf(readFileSync(compiled, 'utf8'));
  const url = pathToFileURL(compiled).href;
  const ran = lines.map(() => false);
  for (const script of scripts.filter((candidate) => candidate.url === url)) {
    ranLines(lines, script).forEach((did, index) => {
      ran[index] ||= did;
    });
  }

  const map = new SourceMap(JSON.parse(readFileSync(`${compiled}.map`, 'utf8')) as SourceMapPayload);
  const source = resolve(dirname(compiled), map.payload.sources[0] ?? '');
  const covered = new Map<number, boolean>();
  lines.forEach((line, index) => {
    if (line.empty) {
      return;
    }
    const original = sourceLine(map, index, line);
    if (original === undefined) {
      return;
    }
    covered.set(original + 1, (covered.get(original + 1) ?? false) || (ran[index] ?? false));
  });
  return { file: relative(root, source), lines: covered };
}

/** the line of the source file the first piece of code in a compiled line was made from, counted from 0 */
function sourceLine(map: SourceMap, index: number, line: Line): number | undefined {
  // the entry for a position is the last one before it, which may belong to the line above
  for (let column = line.column; column < line.length; column++) {
    const entry = map.findEntry(index, column) as { originalLine?: number; generatedLine?: number };
    if (entry.originalLine !== undefined && entry.generatedLine === index) {
      return entry.originalLine;
    }
  }
  return undefined;
}

/** the numbers of the lines as ranges: 3-5, 9 */
function ranges(numbers: number[]): string {
  const parts: string[] = [];
  let from: number | undefined;
  let to = 0;
  for (const number of [...numbers].sort((a, b) => a - b)) {
    if (from !== undefined && number === to + 1) {
      to = number;
      continue;
    }
    if (from !== undefined) {
      parts.push(from === to ? String(from) : `${from}-${to}`);
    }
    from = number;
    to = number;
  }
  if (from !== undefined) {
    parts.push(from === to ? String(from) : `${from}-${to}`);
  }
  return parts.join(', ');
}

if (!existsSync(dist)) {
  console.error('there is no dist/. run `bun run build` first, or `bun run coverage:e2e`, which does.');
  process.exit(1);
}

const directory = mkdtempSync(join(tmpdir(), 'fhem2hb-e2e-coverage-'));
let status: number;
let coverage: FileCoverage[];
try {
  const vitest = join(root, 'node_modules', 'vitest', 'vitest.mjs');
  const run = spawnSync(process.execPath, [vitest, 'run', '--config', 'vitest.e2e.config.ts', ...process.argv.slice(2)], {
    cwd: root,
    stdio: 'inherit',
    env: { ...process.env, E2E_V8_COVERAGE: directory },
  });
  status = run.status ?? 1;

  const scripts = files(directory, '.json').flatMap((file) => (JSON.parse(readFileSync(file, 'utf8')) as { result: ScriptCoverage[] }).result);
  coverage = files(dist, '.js')
    .map((compiled) => coverageOf(compiled, scripts))
    .sort((a, b) => a.file.localeCompare(b.file));
  console.log(`\nline coverage of src/ by ${files(directory, '.json').length} homebridge processes of the end-to-end tests\n`);
} finally {
  rmSync(directory, { recursive: true, force: true });
}

const percent = (covered: number, all: number) => `${all ? ((100 * covered) / all).toFixed(1) : '100.0'} %`;
const row = (name: string, covered: number, all: number) =>
  `${name.padEnd(38)}${String(covered).padStart(6)}${String(all).padStart(6)}${percent(covered, all).padStart(10)}`;
const count = (group: FileCoverage[]) => {
  const all = group.flatMap((file) => [...file.lines.values()]);
  return [all.filter(Boolean).length, all.length] as const;
};

console.log(`${'directory'.padEnd(38)}${'ran'.padStart(6)}${'lines'.padStart(6)}${'covered'.padStart(10)}`);
for (const name of [...new Set(coverage.map((file) => dirname(file.file)))].sort()) {
  console.log(row(name, ...count(coverage.filter((file) => dirname(file.file) === name))));
}
console.log(row('all of src', ...count(coverage)));

console.log(`\n${'file'.padEnd(38)}${'ran'.padStart(6)}${'lines'.padStart(6)}${'covered'.padStart(10)}  lines that did not run`);
for (const file of coverage) {
  const missed = [...file.lines].filter(([, ran]) => !ran).map(([line]) => line);
  console.log(`${row(file.file, ...count([file]))}  ${ranges(missed)}`);
}

process.exit(status);
