// prepares a release: checks that the checkout is the main branch as it is on origin, runs
// `bun run verify`, sets the new version in package.json, commits that as
// `chore(release): vX.Y.Z` and tags the commit with the release notes as the message of the tag.
// the notes are made from the conventional commits since the tag before.
//
// nothing leaves the machine: the script neither pushes nor publishes, and ends by printing the
// commands that do. with --dry-run it changes nothing at all and prints what it would do.
//
//   bun run release <patch|minor|major|prerelease|x.y.z> [--dry-run]
import { execFileSync } from 'node:child_process';
import { readFileSync, realpathSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';

// ---- versions

export interface Version {
  major: number;
  minor: number;
  patch: number;
  /** the parts behind the dash, e.g. `['alpha', 0]` for `1.2.3-alpha.0`. empty for a release. */
  prerelease: (string | number)[];
}

const BUMPS = ['patch', 'minor', 'major', 'prerelease'] as const;
export type Bump = (typeof BUMPS)[number];

/** the version the text stands for, with or without a leading `v`. undefined if it is no version. build metadata is not accepted. */
export function parseVersion(text: string): Version | undefined {
  const match = /^v?(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(?:-([0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*))?$/.exec(text.trim());
  if (!match) {
    return undefined;
  }

  const prerelease = (match[4] ?? '')
    .split('.')
    .filter((part) => part !== '')
    .map((part) => (/^\d+$/.test(part) ? Number(part) : part));
  return { major: Number(match[1]), minor: Number(match[2]), patch: Number(match[3]), prerelease };
}

export function formatVersion(version: Version): string {
  const release = version.major + '.' + version.minor + '.' + version.patch;
  return version.prerelease.length ? release + '-' + version.prerelease.join('.') : release;
}

/** negative if a comes before b, positive if after, 0 if they are the same: the order semver defines */
export function compareVersions(a: Version, b: Version): number {
  for (const part of ['major', 'minor', 'patch'] as const) {
    if (a[part] !== b[part]) {
      return a[part] - b[part];
    }
  }

  // a release comes after its prereleases
  if (!a.prerelease.length || !b.prerelease.length) {
    return (a.prerelease.length ? 0 : 1) - (b.prerelease.length ? 0 : 1);
  }

  for (let i = 0; i < Math.max(a.prerelease.length, b.prerelease.length); i++) {
    const x = a.prerelease[i];
    const y = b.prerelease[i];
    if (x === undefined || y === undefined) {
      // the shorter one comes first
      return x === undefined ? -1 : 1;
    }
    if (x === y) {
      continue;
    }
    if (typeof x === 'number' && typeof y === 'number') {
      return x - y;
    }
    // numbers come before text
    if (typeof x === 'number' || typeof y === 'number') {
      return typeof x === 'number' ? -1 : 1;
    }
    return x < y ? -1 : 1;
  }
  return 0;
}

/**
 * The version that follows the current one, the way `npm version` counts:
 *
 * - `patch`, `minor`, `major`: the next release. A prerelease of that very release becomes the
 *   release, so `1.3.0-alpha.0` becomes `1.3.0` with `patch` and with `minor`.
 * - `prerelease`: the last number of the prerelease is raised (`1.3.0-alpha.0` to `1.3.0-alpha.1`),
 *   and a release becomes the first prerelease of its next patch (`1.2.3` to `1.2.4-0`).
 * - a version: that version, which has to come after the current one.
 *
 * Throws an error that says what is wrong with the request.
 */
export function nextVersion(current: string, release: string): string {
  const from = parseVersion(current);
  if (!from) {
    throw new Error('the current version ' + JSON.stringify(current) + ' is no version of the form x.y.z or x.y.z-pre.n');
  }

  if (!(BUMPS as readonly string[]).includes(release)) {
    const to = parseVersion(release);
    if (!to) {
      throw new Error(JSON.stringify(release) + ' is neither ' + BUMPS.join(', ') + ' nor a version of the form x.y.z or x.y.z-pre.n');
    }
    if (compareVersions(to, from) <= 0) {
      throw new Error('the version ' + formatVersion(to) + ' does not come after the current version ' + formatVersion(from));
    }
    return formatVersion(to);
  }

  const wasPrerelease = from.prerelease.length > 0;
  const to: Version = { ...from, prerelease: [] };
  switch (release as Bump) {
    case 'major':
      if (!(wasPrerelease && from.minor === 0 && from.patch === 0)) {
        to.major++;
      }
      to.minor = 0;
      to.patch = 0;
      break;
    case 'minor':
      if (!(wasPrerelease && from.patch === 0)) {
        to.minor++;
      }
      to.patch = 0;
      break;
    case 'patch':
      if (!wasPrerelease) {
        to.patch++;
      }
      break;
    case 'prerelease':
      if (wasPrerelease) {
        to.prerelease = [...from.prerelease];
        let last = to.prerelease.length - 1;
        while (last >= 0 && typeof to.prerelease[last] !== 'number') {
          last--;
        }
        if (last >= 0) {
          to.prerelease[last] = (to.prerelease[last] as number) + 1;
        } else {
          to.prerelease.push(0);
        }
      } else {
        to.patch++;
        to.prerelease = [0];
      }
      break;
  }
  return formatVersion(to);
}

/** the text of a package.json with its version replaced, everything else as it was */
export function withVersion(packageJson: string, version: string): string {
  const line = /^(\s*"version"\s*:\s*")[^"]*(")/m;
  const text = packageJson.replace(line, (_all, before: string, after: string) => before + version + after);
  if (!line.test(packageJson) || (JSON.parse(text) as { version?: unknown }).version !== version) {
    throw new Error('package.json has no "version" on a line of its own to replace');
  }
  return text;
}

// ---- release notes

export interface Commit {
  hash: string;
  subject: string;
  /** the message below the subject */
  body: string;
}

export interface ReleaseNotes {
  breaking: string[];
  features: string[];
  fixes: string[];
  other: string[];
}

/** what the body of a commit says behind `BREAKING CHANGE:`, up to the next empty line, as one line. undefined without such a line. */
function breakingChange(body: string): string | undefined {
  const marker = /^BREAKING[ -]CHANGE:\s*/m.exec(body);
  if (!marker) {
    return undefined;
  }
  const paragraph = body.slice(marker.index + marker[0].length).split(/\n\s*\n/)[0] ?? '';
  return paragraph
    .split('\n')
    .map((line) => line.trim())
    .join(' ')
    .trim();
}

/**
 * Sorts the commits into the groups of the release notes, each as one line, in the order given.
 *
 * A commit is breaking with a `!` before the colon of its subject, or with a `BREAKING CHANGE:`
 * line in its body, whose text is put below the subject. `feat` commits are features, `fix`
 * commits fixes, and everything else is listed with its subject as it is, also commits that do
 * not follow the convention. The commits of earlier releases, `chore(release): ...`, are left out.
 */
export function groupCommits(commits: Commit[]): ReleaseNotes {
  const notes: ReleaseNotes = { breaking: [], features: [], fixes: [], other: [] };

  for (const commit of commits) {
    const subject = commit.subject.trim();
    const hash = ' (' + commit.hash.slice(0, 7) + ')';
    const match = /^(\w+)(?:\(([^)]*)\))?(!)?:\s*(.+)$/.exec(subject);
    const type = match?.[1]?.toLowerCase();
    const scope = match?.[2];
    const description = match?.[4] ?? subject;

    if (type === 'chore' && scope === 'release') {
      continue;
    }

    const footer = breakingChange(commit.body);
    if (match?.[3] === '!' || footer !== undefined) {
      notes.breaking.push('- ' + subject + hash + (footer === undefined ? '' : '\n  ' + footer));
    } else if (type === 'feat') {
      notes.features.push('- ' + (scope ? scope + ': ' : '') + description + hash);
    } else if (type === 'fix') {
      notes.fixes.push('- ' + (scope ? scope + ': ' : '') + description + hash);
    } else {
      notes.other.push('- ' + subject + hash);
    }
  }

  return notes;
}

/** the release notes as the message of the tag: plain text, with the groups that have entries */
export function formatNotes(name: string, version: string, notes: ReleaseNotes): string {
  const sections: [string, string[]][] = [
    ['Breaking changes', notes.breaking],
    ['Features', notes.features],
    ['Fixes', notes.fixes],
    ['Other changes', notes.other],
  ];

  let text = name + ' v' + version + '\n';
  for (const [title, lines] of sections) {
    if (lines.length) {
      text += '\n' + title + ':\n' + lines.join('\n') + '\n';
    }
  }
  if (sections.every(([, lines]) => !lines.length)) {
    text += '\nNo changes.\n';
  }
  return text;
}

// ---- the command line

export interface Arguments {
  /** patch, minor, major, prerelease or a version */
  release: string;
  dryRun: boolean;
}

export const USAGE = 'usage: bun run release <patch|minor|major|prerelease|x.y.z> [--dry-run]';

/** what the command line asks for. throws an error for anything but one release and the option. */
export function parseArguments(argv: string[]): Arguments {
  const options = argv.filter((argument) => argument.startsWith('--'));
  const others = argv.filter((argument) => !argument.startsWith('--'));
  const unknown = options.find((option) => option !== '--dry-run');
  if (unknown !== undefined) {
    throw new Error('unknown option ' + unknown);
  }
  const [release, ...rest] = others;
  if (release === undefined || rest.length) {
    throw new Error('exactly one of patch, minor, major, prerelease or a version is needed');
  }
  return { release, dryRun: options.includes('--dry-run') };
}

// ---- what touches the repository

const root = join(import.meta.dirname, '..');
const MAIN = 'main';
const REMOTE = 'origin';

/** the output of a git command, without the line break at its end */
function git(...args: string[]): string {
  return execFileSync('git', args, { cwd: root, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trimEnd();
}

/** like git, undefined when the command fails */
function gitOrNothing(...args: string[]): string | undefined {
  try {
    return git(...args);
  } catch {
    return undefined;
  }
}

/** why the release can not be made from this checkout. empty if it can. reads only, also from origin. */
function obstacles(tag: string): string[] {
  const problems: string[] = [];

  const branch = gitOrNothing('rev-parse', '--abbrev-ref', 'HEAD');
  if (branch !== MAIN) {
    problems.push('the branch is ' + (branch ?? 'unknown') + ', a release is made from ' + MAIN);
  }

  const changes = git('status', '--porcelain');
  if (changes !== '') {
    problems.push('the working tree is not clean:\n' + changes);
  }

  const local = gitOrNothing('rev-parse', '--verify', '--quiet', 'refs/heads/' + MAIN);
  const listed = gitOrNothing('ls-remote', REMOTE, 'refs/heads/' + MAIN, 'refs/tags/' + tag);
  if (local === undefined) {
    problems.push('there is no local branch ' + MAIN);
  }
  if (listed === undefined) {
    problems.push(REMOTE + ' can not be asked for its ' + MAIN + ' branch and its tags');
  } else {
    // each line is the commit, a tab and the name
    const refs = new Map(
      listed.split('\n').map((line): [string, string] => {
        const [commit = '', name = ''] = line.split('\t');
        return [name, commit];
      }),
    );
    const remote = refs.get('refs/heads/' + MAIN);
    if (local !== undefined && remote !== local) {
      problems.push('local ' + MAIN + ' (' + local.slice(0, 7) + ') is not ' + REMOTE + '/' + MAIN + ' (' + (remote?.slice(0, 7) ?? 'missing') + ')');
    }
    if (refs.has('refs/tags/' + tag)) {
      problems.push('the tag ' + tag + ' exists on ' + REMOTE);
    }
  }

  if (gitOrNothing('rev-parse', '--verify', '--quiet', 'refs/tags/' + tag) !== undefined) {
    problems.push('the tag ' + tag + ' exists');
  }

  return problems;
}

/** the last release tag that leads to this commit, undefined if there is none */
function previousTag(): string | undefined {
  return gitOrNothing('describe', '--tags', '--abbrev=0', '--match', 'v[0-9]*');
}

/** the commits since the tag, or all of them, oldest first, without merges */
function commitsSince(tag: string | undefined): Commit[] {
  // git writes the separators for %x1f and %x1e: no subject or body holds them
  const fields = '\u001f';
  const records = '\u001e';
  const range = tag === undefined ? 'HEAD' : tag + '..HEAD';
  const log = git('log', '--no-merges', '--reverse', '--format=%H%x1f%s%x1f%b%x1e', range);
  return log
    .split(records)
    .map((record) => record.trim())
    .filter((record) => record !== '')
    .map((record) => {
      const [hash = '', subject = '', body = ''] = record.split(fields);
      return { hash, subject, body };
    });
}

function main(argv: string[]): number {
  let wanted: Arguments;
  try {
    wanted = parseArguments(argv);
  } catch (error) {
    console.error((error as Error).message + '\n' + USAGE);
    return 2;
  }

  const packagePath = join(root, 'package.json');
  const packageJson = readFileSync(packagePath, 'utf8');
  const pkg = JSON.parse(packageJson) as { name: string; version: string; private?: boolean };

  let version: string;
  try {
    version = nextVersion(pkg.version, wanted.release);
  } catch (error) {
    console.error((error as Error).message + '\n' + USAGE);
    return 2;
  }
  const tag = 'v' + version;
  const message = 'chore(release): ' + tag;

  const problems = obstacles(tag);
  const since = previousTag();
  const notes = formatNotes(pkg.name, version, groupCommits(commitsSince(since)));
  const pushCommands = ['git push ' + REMOTE + ' ' + MAIN, 'git push ' + REMOTE + ' ' + tag];
  const aboutPublishing = pkg.private
    ? 'package.json says "private": true, so npm refuses to publish this package. Publishing a release needs that line removed first.'
    : 'To publish the release after pushing: npm publish' + (parseVersion(version)?.prerelease.length ? ' --tag next' : '');

  if (wanted.dryRun) {
    console.log('dry run: nothing is changed.\n');
    console.log('version: ' + pkg.version + ' -> ' + version);
    console.log('notes from: ' + (since === undefined ? 'the first commit' : 'the commits since ' + since) + '\n');
    console.log('would');
    console.log('  1. run: bun run verify');
    console.log('  2. set "version" in package.json to ' + version);
    console.log('  3. commit package.json as: ' + message);
    console.log('  4. create the annotated tag ' + tag + ' with these notes as its message:\n');
    console.log(notes);
    console.log('and would then leave it to you to run:');
    console.log(pushCommands.map((command) => '  ' + command).join('\n'));
    console.log('\n' + aboutPublishing);
    if (problems.length) {
      console.error('\nthe release would be refused here:\n' + problems.map((problem) => '  - ' + problem).join('\n'));
      return 1;
    }
    return 0;
  }

  if (problems.length) {
    console.error('no release is made:\n' + problems.map((problem) => '  - ' + problem).join('\n'));
    return 1;
  }

  console.log('releasing ' + pkg.name + ' ' + pkg.version + ' -> ' + version + '\n');
  try {
    execFileSync('bun', ['run', 'verify'], { cwd: root, stdio: 'inherit' });
  } catch {
    console.error('\nno release is made: bun run verify failed.');
    return 1;
  }
  const left = git('status', '--porcelain');
  if (left !== '') {
    console.error('\nno release is made: bun run verify changed the working tree:\n' + left);
    return 1;
  }

  writeFileSync(packagePath, withVersion(packageJson, version));
  try {
    git('add', 'package.json');
    git('commit', '--message', message);
  } catch (error) {
    writeFileSync(packagePath, packageJson);
    gitOrNothing('reset', '--quiet', 'HEAD', '--', 'package.json');
    console.error('\nno release is made: the commit failed, package.json is as it was.\n' + String(error));
    return 1;
  }
  try {
    execFileSync('git', ['tag', '--annotate', tag, '--cleanup=verbatim', '--file', '-'], { cwd: root, input: notes, stdio: ['pipe', 'inherit', 'inherit'] });
  } catch (error) {
    console.error('\nthe commit "' + message + '" was made, but the tag failed. undo the commit with: git reset --hard HEAD~1\n' + String(error));
    return 1;
  }

  console.log('\n' + notes);
  console.log('committed "' + message + '" and tagged it ' + tag + '. Nothing was pushed or published.\n');
  console.log('To push the commit and the tag:');
  console.log(pushCommands.map((command) => '  ' + command).join('\n'));
  console.log('\n' + aboutPublishing);
  return 0;
}

// only when run as a script, not when the tests import the functions above
if (process.argv[1] !== undefined && pathToFileURL(realpathSync(process.argv[1])).href === import.meta.url) {
  process.exitCode = main(process.argv.slice(2));
}
