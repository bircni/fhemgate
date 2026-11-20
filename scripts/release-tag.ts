// what .github/workflows/release.yml checks before it publishes a pushed tag: that the tag is the
// version in package.json, and that the package may be published. it prints the npm dist-tag and
// whether the version is a prerelease, as lines for $GITHUB_OUTPUT. with --npm it also checks that
// the npm that publishes can use trusted publishing.
//
//   node scripts/release-tag.ts <tag> [--npm <version of npm>]
import { readFileSync, realpathSync } from 'node:fs';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { compareVersions, distTag, parseVersion, type Version } from './release.ts';

/** the oldest npm that publishes with trusted publishing: https://docs.npmjs.com/trusted-publishers */
export const TRUSTED_PUBLISHING_NPM = '11.5.1';

export interface TagRelease {
  distTag: 'latest' | 'next';
  prerelease: boolean;
}

/** what the tag publishes. throws if the tag is not `v` and the version of the package.json, or if the package is private. */
export function releaseOfTag(tag: string, pkg: { name: string; version: string; private?: unknown }): TagRelease {
  const version = parseVersion(pkg.version);
  if (!version) {
    throw new Error('package.json has the version ' + JSON.stringify(pkg.version) + ', which is no version of the form x.y.z or x.y.z-pre.n');
  }
  if (tag !== 'v' + pkg.version) {
    throw new Error('the tag ' + tag + ' is not v' + pkg.version + ', the version package.json of the tagged commit has');
  }
  if (pkg.private === true) {
    throw new Error('package.json says "private": true, so ' + pkg.name + ' can not be published');
  }
  return { distTag: distTag(version), prerelease: version.prerelease.length > 0 };
}

/** whether this version of npm can publish with trusted publishing */
export function supportsTrustedPublishing(npmVersion: string): boolean {
  const version = parseVersion(npmVersion);
  return version !== undefined && compareVersions(version, parseVersion(TRUSTED_PUBLISHING_NPM) as Version) >= 0;
}

function main(argv: string[]): number {
  const [tag, option, npmVersion, ...rest] = argv;
  if (tag === undefined || tag.startsWith('-') || (option !== undefined && (option !== '--npm' || npmVersion === undefined)) || rest.length) {
    console.error('usage: node scripts/release-tag.ts <tag> [--npm <version of npm>]');
    return 2;
  }

  const pkg = JSON.parse(readFileSync(join(import.meta.dirname, '..', 'package.json'), 'utf8')) as { name: string; version: string; private?: unknown };
  let release: TagRelease;
  try {
    release = releaseOfTag(tag, pkg);
  } catch (error) {
    console.error((error as Error).message);
    return 1;
  }
  if (npmVersion !== undefined && !supportsTrustedPublishing(npmVersion)) {
    console.error('npm ' + npmVersion + ' can not publish with trusted publishing, that needs npm ' + TRUSTED_PUBLISHING_NPM + ' or later');
    return 1;
  }

  console.log('dist-tag=' + release.distTag);
  console.log('prerelease=' + String(release.prerelease));
  return 0;
}

// only when run as a script, not when the tests import the functions above
if (process.argv[1] !== undefined && pathToFileURL(realpathSync(process.argv[1])).href === import.meta.url) {
  process.exitCode = main(process.argv.slice(2));
}
