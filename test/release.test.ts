// the parts of scripts/release.ts that decide something without touching the repository
import { describe, expect, it } from 'vitest';
import {
  compareVersions,
  formatNotes,
  formatVersion,
  groupCommits,
  nextVersion,
  parseArguments,
  parseVersion,
  withVersion,
  type Commit,
} from '../scripts/release.ts';

const commit = (subject: string, body = '', hash = 'abcdef0123456789'): Commit => ({ hash, subject, body });

describe('a version', () => {
  it('is read with its prerelease, with or without a v in front', () => {
    expect(parseVersion('1.2.3')).toEqual({ major: 1, minor: 2, patch: 3, prerelease: [] });
    expect(parseVersion('v0.6.0-alpha.0')).toEqual({ major: 0, minor: 6, patch: 0, prerelease: ['alpha', 0] });
    expect(formatVersion({ major: 0, minor: 6, patch: 0, prerelease: ['alpha', 0] })).toBe('0.6.0-alpha.0');
  });

  it.each(['', '1.2', '1.2.3.4', '01.2.3', '1.2.3-', '1.2.3+build', 'patch', 'latest'])('is not %j', (text) => {
    expect(parseVersion(text)).toBeUndefined();
  });

  it('comes after its prereleases, and prereleases are ordered part by part', () => {
    const sorted = [
      '1.0.0-alpha',
      '1.0.0-alpha.1',
      '1.0.0-alpha.beta',
      '1.0.0-beta',
      '1.0.0-beta.2',
      '1.0.0-beta.11',
      '1.0.0-rc.1',
      '1.0.0',
      '1.0.1',
      '1.1.0',
      '2.0.0',
    ];
    const shuffled = sorted.map((_, index) => sorted[sorted.length - 1 - index] as string);
    shuffled.sort((a, b) => compareVersions(parseVersion(a) as never, parseVersion(b) as never));
    expect(shuffled).toEqual(sorted);
    expect(compareVersions(parseVersion('1.2.3-rc.1') as never, parseVersion('1.2.3-rc.1') as never)).toBe(0);
  });
});

describe('the next version', () => {
  it.each([
    ['1.2.3', 'patch', '1.2.4'],
    ['1.2.3', 'minor', '1.3.0'],
    ['1.2.3', 'major', '2.0.0'],
    ['1.2.3', 'prerelease', '1.2.4-0'],
    // a prerelease of the release that is asked for becomes that release
    ['0.6.0-alpha.0', 'patch', '0.6.0'],
    ['0.6.0-alpha.0', 'minor', '0.6.0'],
    ['0.6.0-alpha.0', 'major', '1.0.0'],
    ['1.0.0-rc.1', 'major', '1.0.0'],
    ['0.6.1-alpha.0', 'minor', '0.7.0'],
    ['0.6.0-alpha.0', 'prerelease', '0.6.0-alpha.1'],
    ['0.6.0-alpha', 'prerelease', '0.6.0-alpha.0'],
    ['0.6.0-1.beta', 'prerelease', '0.6.0-2.beta'],
    ['0.6.0-alpha.0', '0.6.0-beta.0', '0.6.0-beta.0'],
    ['0.6.0-alpha.0', 'v0.6.0', '0.6.0'],
  ])('after %s is, for %s, %s', (current, release, expected) => {
    expect(nextVersion(current, release)).toBe(expected);
  });

  it('has to come after the current one', () => {
    expect(() => nextVersion('0.6.0-alpha.0', '0.5.9')).toThrow('does not come after');
    expect(() => nextVersion('0.6.0', '0.6.0')).toThrow('does not come after');
    expect(() => nextVersion('0.6.0', '0.6.0-rc.1')).toThrow('does not come after');
  });

  it('is refused for a request or a current version that is none', () => {
    expect(() => nextVersion('0.6.0', 'bugfix')).toThrow('"bugfix" is neither patch, minor, major, prerelease nor a version');
    expect(() => nextVersion('next', 'patch')).toThrow('the current version "next" is no version');
  });

  it('replaces the version in package.json and nothing else', () => {
    const before = '{\n  "name": "x",\n  "version": "0.6.0-alpha.0",\n  "dependencies": { "y": "0.6.0-alpha.0" }\n}\n';
    expect(withVersion(before, '0.6.0')).toBe('{\n  "name": "x",\n  "version": "0.6.0",\n  "dependencies": { "y": "0.6.0-alpha.0" }\n}\n');
    expect(() => withVersion('{ "name": "x" }', '0.6.0')).toThrow('no "version"');
  });
});

describe('the release notes', () => {
  it('group features, fixes and the rest, in the order of the commits', () => {
    const notes = groupCommits([
      commit('feat: support HomeMatic IP devices via HMCCU', '', '1111111aaaa'),
      commit('fix(parser): read a mapping on several lines', '', '2222222aaaa'),
      commit('docs: describe the options', '', '3333333aaaa'),
      commit('feat(history): keep a history for plugs', '', '4444444aaaa'),
      commit('Merge the old way of doing it', '', '5555555aaaa'),
    ]);

    expect(notes).toEqual({
      breaking: [],
      features: ['- support HomeMatic IP devices via HMCCU (1111111)', '- history: keep a history for plugs (4444444)'],
      fixes: ['- parser: read a mapping on several lines (2222222)'],
      other: ['- docs: describe the options (3333333)', '- Merge the old way of doing it (5555555)'],
    });
  });

  it('list a commit as breaking for a ! in its subject or a BREAKING CHANGE line in its body, and nowhere else', () => {
    const notes = groupCommits([
      commit('feat!: drop node 20', '', '1111111aaaa'),
      commit('fix(config)!: check the certificate unless told not to', '', '2222222aaaa'),
      commit('refactor: read the configuration in one place', 'some text\n\nBREAKING CHANGE: the option ssl has to be\n  a boolean\n\nRefs: 12', '3333333aaaa'),
      commit('fix: a fix', 'BREAKING-CHANGE: with a dash', '4444444aaaa'),
    ]);

    expect(notes.breaking).toEqual([
      '- feat!: drop node 20 (1111111)',
      '- fix(config)!: check the certificate unless told not to (2222222)',
      '- refactor: read the configuration in one place (3333333)\n  the option ssl has to be a boolean',
      '- fix: a fix (4444444)\n  with a dash',
    ]);
    expect([notes.features, notes.fixes, notes.other]).toEqual([[], [], []]);
  });

  it('leave out the commits of earlier releases', () => {
    expect(groupCommits([commit('chore(release): v0.5.0'), commit('chore: update the lockfile')]).other).toEqual(['- chore: update the lockfile (abcdef0)']);
  });

  it('are plain text with a section for every group that has entries', () => {
    const notes = formatNotes('homebridge-fhem2hb', '0.6.0', { breaking: ['- b'], features: ['- f1', '- f2'], fixes: [], other: ['- o'] });
    expect(notes).toBe('homebridge-fhem2hb v0.6.0\n\nBreaking changes:\n- b\n\nFeatures:\n- f1\n- f2\n\nOther changes:\n- o\n');
    expect(notes).not.toMatch(/^#/m);
  });

  it('say so when nothing changed', () => {
    expect(formatNotes('x', '1.0.0', { breaking: [], features: [], fixes: [], other: [] })).toBe('x v1.0.0\n\nNo changes.\n');
  });
});

describe('the command line', () => {
  it('names the release and whether it is a dry run, in any order', () => {
    expect(parseArguments(['patch'])).toEqual({ release: 'patch', dryRun: false });
    expect(parseArguments(['--dry-run', '1.0.0'])).toEqual({ release: '1.0.0', dryRun: true });
    expect(parseArguments(['minor', '--dry-run'])).toEqual({ release: 'minor', dryRun: true });
  });

  it('is refused without a release, with two, or with an option that is not known', () => {
    expect(() => parseArguments([])).toThrow('exactly one of');
    expect(() => parseArguments(['--dry-run'])).toThrow('exactly one of');
    expect(() => parseArguments(['patch', 'minor'])).toThrow('exactly one of');
    expect(() => parseArguments(['patch', '--push'])).toThrow('unknown option --push');
  });
});
