// the parts of scripts/release.ts that decide something without touching the repository
import { describe, expect, it } from 'vitest';
import { releaseOfTag, supportsTrustedPublishing, TRUSTED_PUBLISHING_NPM } from '../scripts/release-tag.ts';
import {
  compareVersions,
  distTag,
  formatNotes,
  formatVersion,
  groupCommits,
  nextVersion,
  parseArguments,
  parseVersion,
  previousRelease,
  withVersion,
  type Commit,
  type ReleaseTag,
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

  it('starts from 0.0.0 with the first release asked for by its number', () => {
    expect(nextVersion('0.0.0', '0.1.0')).toBe('0.1.0');
    expect(nextVersion('0.0.0', 'minor')).toBe('0.1.0');
  });

  it('replaces the version in package.json and nothing else', () => {
    const before = '{\n  "name": "x",\n  "version": "0.6.0-alpha.0",\n  "dependencies": { "y": "0.6.0-alpha.0" }\n}\n';
    expect(withVersion(before, '0.6.0')).toBe('{\n  "name": "x",\n  "version": "0.6.0",\n  "dependencies": { "y": "0.6.0-alpha.0" }\n}\n');
    expect(() => withVersion('{ "name": "x" }', '0.6.0')).toThrow('no "version"');
  });
});

describe('the npm dist-tag', () => {
  it('is next for a prerelease, so that an install without a tag never gets one, and latest otherwise', () => {
    expect(distTag(parseVersion('0.1.0') as never)).toBe('latest');
    expect(distTag(parseVersion('1.0.0-rc.1') as never)).toBe('next');
    expect(distTag(parseVersion('0.6.0-alpha.0') as never)).toBe('next');
  });
});

describe('the release before', () => {
  const ours = (tag: string): ReleaseTag => ({ tag, packageName: 'homebridge-fhemgate' });
  // the tags homebridge-fhem left in the repository
  const upstream = (tag: string): ReleaseTag => ({ tag, packageName: 'homebridge-fhem' });

  it('is none for the first release, also with the higher tags of homebridge-fhem in the repository', () => {
    expect(previousRelease([upstream('v0.5.54'), upstream('v0.5.27')], 'homebridge-fhemgate', '0.1.0')).toBeUndefined();
    expect(previousRelease([upstream('v0.5.54')], 'homebridge-fhemgate', '0.6.0')).toBeUndefined();
    expect(previousRelease([], 'homebridge-fhemgate', '0.1.0')).toBeUndefined();
  });

  it('is the highest release of this package below the new version', () => {
    const tags = [upstream('v0.5.54'), ours('v0.1.0'), ours('v0.2.0-rc.1'), ours('v0.1.1'), ours('v0.3.0')];
    expect(previousRelease(tags, 'homebridge-fhemgate', '0.2.0')).toBe('v0.2.0-rc.1');
    expect(previousRelease(tags, 'homebridge-fhemgate', '0.2.0-rc.2')).toBe('v0.2.0-rc.1');
    expect(previousRelease(tags, 'homebridge-fhemgate', '0.2.0-rc.1')).toBe('v0.1.1');
    expect(previousRelease(tags, 'homebridge-fhemgate', '1.0.0')).toBe('v0.3.0');
  });

  it('ignores tags that are no versions, and commits without a package.json', () => {
    const tags = [ours('v-next'), { tag: 'v0.4.0', packageName: undefined }, ours('v0.1.0')];
    expect(previousRelease(tags, 'homebridge-fhemgate', '0.5.0')).toBe('v0.1.0');
    expect(previousRelease(tags, 'homebridge-fhemgate', 'latest')).toBeUndefined();
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
      other: ['- Merge the old way of doing it (5555555)'],
      internal: 1,
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
    expect([notes.features, notes.fixes, notes.other, notes.internal]).toEqual([[], [], [], 0]);
  });

  it('count the commits that change nothing for users instead of listing them, unless they are breaking', () => {
    const notes = groupCommits([
      commit('build: prepare the package for publishing'),
      commit('ci: publish a tagged release'),
      commit('chore: update the lockfile'),
      commit('docs(readme): install from npm'),
      commit('refactor: one place for the options'),
      commit('style: format'),
      commit('test(e2e): cover the migration'),
      commit('build!: drop node 20', '', '1111111aaaa'),
      commit('perf: read the readings once', '', '2222222aaaa'),
    ]);

    expect(notes).toEqual({
      breaking: ['- build!: drop node 20 (1111111)'],
      features: [],
      fixes: [],
      other: ['- perf: read the readings once (2222222)'],
      internal: 7,
    });
  });

  it('leave out the commits of earlier releases', () => {
    expect(groupCommits([commit('chore(release): v0.5.0'), commit('Update the lockfile')])).toEqual({
      breaking: [],
      features: [],
      fixes: [],
      other: ['- Update the lockfile (abcdef0)'],
      internal: 0,
    });
  });

  it('are plain text with a section for every group that has entries', () => {
    const notes = formatNotes('homebridge-fhemgate', '0.6.0', { breaking: ['- b'], features: ['- f1', '- f2'], fixes: [], other: ['- o'], internal: 0 });
    expect(notes).toBe('homebridge-fhemgate v0.6.0\n\nBreaking changes:\n- b\n\nFeatures:\n- f1\n- f2\n\nOther changes:\n- o\n');
    expect(notes).not.toMatch(/^#/m);
  });

  it('end with the number of internal changes', () => {
    expect(formatNotes('x', '1.0.0', { breaking: [], features: [], fixes: ['- f'], other: [], internal: 3 })).toBe(
      'x v1.0.0\n\nFixes:\n- f\n\nand 3 internal changes (tests, build, documentation).\n',
    );
    expect(formatNotes('x', '1.0.0', { breaking: [], features: [], fixes: ['- f'], other: [], internal: 1 })).toContain('and 1 internal change (tests');
  });

  it('say so when nothing changed, or nothing for users', () => {
    expect(formatNotes('x', '1.0.0', { breaking: [], features: [], fixes: [], other: [], internal: 0 })).toBe('x v1.0.0\n\nNo changes.\n');
    expect(formatNotes('x', '1.0.0', { breaking: [], features: [], fixes: [], other: [], internal: 2 })).toBe(
      'x v1.0.0\n\nNothing changes for users: 2 internal changes (tests, build, documentation).\n',
    );
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

  it('takes the ref the notes start after, as the next argument or after an equals sign', () => {
    expect(parseArguments(['0.1.0', '--notes-from', 'bcfc357^', '--dry-run'])).toEqual({ release: '0.1.0', dryRun: true, notesFrom: 'bcfc357^' });
    expect(parseArguments(['--notes-from=v0.1.0', 'patch'])).toEqual({ release: 'patch', dryRun: false, notesFrom: 'v0.1.0' });
  });

  it('is refused for --notes-from without a ref', () => {
    expect(() => parseArguments(['patch', '--notes-from'])).toThrow('--notes-from needs a ref');
    expect(() => parseArguments(['patch', '--notes-from='])).toThrow('--notes-from needs a ref');
    expect(() => parseArguments(['patch', '--notes-from', '--dry-run'])).toThrow('--notes-from needs a ref');
  });
});

describe('a pushed tag', () => {
  const pkg = { name: 'homebridge-fhemgate', version: '0.1.0' };

  it('publishes a release under latest and a prerelease under next', () => {
    expect(releaseOfTag('v0.1.0', pkg)).toEqual({ distTag: 'latest', prerelease: false });
    expect(releaseOfTag('v1.0.0-rc.1', { ...pkg, version: '1.0.0-rc.1' })).toEqual({ distTag: 'next', prerelease: true });
  });

  it('is refused unless it is v and the version of package.json', () => {
    expect(() => releaseOfTag('v0.1.1', pkg)).toThrow('the tag v0.1.1 is not v0.1.0');
    expect(() => releaseOfTag('0.1.0', pkg)).toThrow('is not v0.1.0');
    expect(() => releaseOfTag('v0.5.54', pkg)).toThrow('is not v0.1.0');
    expect(() => releaseOfTag('vnext', { ...pkg, version: 'next' })).toThrow('no version');
  });

  it('is refused for a private package', () => {
    expect(() => releaseOfTag('v0.1.0', { ...pkg, private: true })).toThrow('"private": true');
  });

  it('is published only by an npm that can use trusted publishing', () => {
    expect(supportsTrustedPublishing(TRUSTED_PUBLISHING_NPM)).toBe(true);
    expect(supportsTrustedPublishing('11.20.0')).toBe(true);
    expect(supportsTrustedPublishing('12.0.0')).toBe(true);
    expect(supportsTrustedPublishing('11.5.0')).toBe(false);
    expect(supportsTrustedPublishing('10.9.2')).toBe(false);
    expect(supportsTrustedPublishing('npm')).toBe(false);
  });
});
