// what an installation that comes from homebridge-fhem can run into, looked for when homebridge
// starts. everything here only reports: nothing stops the platform or homebridge.
import { readFileSync } from 'node:fs';
import { basename, dirname, join } from 'node:path';
import type { ConnectionConfig } from './config.ts';
import { LEGACY_UUID_PREFIX } from './devices/identity.ts';
import { PLATFORM_NAME, PLUGIN_NAME } from './settings.ts';

/** the plugin this one replaces. it registers the platform FHEM as well. */
export const OLD_PLUGIN_NAME = 'homebridge-fhem';

function readJson(file: string): unknown {
  try {
    return JSON.parse(readFileSync(file, 'utf8')) as unknown;
  } catch {
    return undefined;
  }
}

/**
 * The directory homebridge-fhem is installed in, if it is installed next to this plugin: in the
 * same `node_modules` directory, which is where homebridge looks for both.
 *
 * @param pluginRoot the directory this plugin is installed in
 */
export function findOldPlugin(pluginRoot: string): string | undefined {
  const modules = dirname(pluginRoot);
  if (basename(modules) !== 'node_modules') {
    return undefined;
  }

  const directory = join(modules, OLD_PLUGIN_NAME);
  const manifest = readJson(join(directory, 'package.json')) as { name?: unknown } | null | undefined;
  return manifest?.name === OLD_PLUGIN_NAME ? directory : undefined;
}

/** the platform names of homebridge-fhem, as a config.json can give them */
const OLD_PLATFORMS = new Set([LEGACY_UUID_PREFIX, OLD_PLUGIN_NAME + '.' + LEGACY_UUID_PREFIX, PLUGIN_NAME + '.' + LEGACY_UUID_PREFIX]);

/**
 * What is wrong with the configuration of homebridge, for the log. Asked once, when homebridge
 * loads the plugin.
 *
 * A config entry for homebridge-fhem keeps its platform name, `FHEM`, when this plugin replaces
 * it. Without homebridge-fhem no plugin serves it, and homebridge only says that it found no
 * plugin for it. So this says what the entry has to look like now.
 *
 * @param pluginRoot the directory this plugin is installed in
 * @param configPath the config.json of homebridge
 */
export function installationWarnings(pluginRoot: string, configPath: string): string[] {
  const config = readJson(configPath) as { disabledPlugins?: unknown; platforms?: unknown } | null | undefined;
  const platforms = (Array.isArray(config?.platforms) ? (config.platforms as ({ platform?: unknown } | null)[]) : []).map((platform) => platform?.platform);
  const old = platforms.filter((name): name is string => typeof name === 'string' && OLD_PLATFORMS.has(name));
  if (old.length === 0) {
    return [];
  }

  // homebridge itself leaves a disabled plugin out when it looks for the plugin of a platform
  const disabled = Array.isArray(config?.disabledPlugins) && config.disabledPlugins.includes(OLD_PLUGIN_NAME);
  const oldPlugin = disabled ? undefined : findOldPlugin(pluginRoot);
  // homebridge-fhem serves what does not name this plugin
  const unserved = oldPlugin === undefined ? old : old.filter((name) => name.startsWith(PLUGIN_NAME + '.'));
  if (oldPlugin !== undefined && unserved.length === 0) {
    return platforms.includes(PLATFORM_NAME)
      ? [
          `${OLD_PLUGIN_NAME} is installed as well, in ${oldPlugin}, and both have a platform in config.json. ` +
            'a device both publish has the same identity, and homebridge publishes it only once. ' +
            `uninstall ${OLD_PLUGIN_NAME} and remove its platform from config.json, see docs/migration.md.`,
        ]
      : [];
  }

  const several =
    unserved.length > 1
      ? ' homebridge runs one fhemgate platform per bridge: merge the entries of one bridge into one, with the others as its connections.'
      : '';
  return unserved.map(
    (name) =>
      `config.json has a platform "${name}", which no plugin serves: ${PLUGIN_NAME} answers to "platform": "${PLATFORM_NAME}". ` +
      `change the entry to "platform": "${PLATFORM_NAME}", "migrateFrom": "${name}", so that HomeKit keeps its accessories, see docs/migration.md.` +
      several,
  );
}

/** a line for the log of a platform */
export interface ConfigFinding {
  /** `warn` for what can keep the platform from working, `info` for what only is of no use any more */
  level: 'warn' | 'info';
  text: string;
}

/**
 * What the configuration of a platform holds that homebridge-fhem acted on and this plugin does
 * not, or that only somebody who comes from there has. Each finding names the key and says what
 * to do.
 *
 * homebridge-fhem handed `auth` to its http library as it was. That library waited for FHEMWEB
 * to ask before it sent user and password, unless `sendImmediately` was true, and answered a
 * request for digest authentication. It also took a `bearer` token. This plugin sends user and
 * password with every request, as basic authentication, and nothing else.
 */
export function connectionFindings(config: ConnectionConfig): ConfigFinding[] {
  const findings: ConfigFinding[] = [];

  if (config.neverTimeout !== undefined) {
    findings.push({
      level: 'info',
      text: 'config: neverTimeout is not needed any more and can be removed. fhem is tried for as long as homebridge runs, and the accessories stay meanwhile.',
    });
  }

  const auth = config.auth as Record<string, unknown> | null | undefined;
  if (auth && typeof auth === 'object') {
    if (auth.sendImmediately === true) {
      findings.push({
        level: 'info',
        text: 'config: auth.sendImmediately is not needed any more and can be removed. user and password are always sent with the first request.',
      });
    } else if ('sendImmediately' in auth) {
      findings.push({
        level: 'warn',
        text:
          'config: auth.sendImmediately is not used any more. user and password are sent with every request, as basic authentication, ' +
          'and digest authentication is not possible. remove auth.sendImmediately. ' +
          'if FHEMWEB or a proxy in front of it asks for digest authentication, change that to basic authentication.',
      });
    }
    if ('bearer' in auth) {
      findings.push({
        level: 'warn',
        text: 'config: auth.bearer is not supported. only auth.user and auth.pass are sent, as basic authentication. remove auth.bearer.',
      });
    }
  }

  return findings;
}

/** what the options of the platform itself say that is worth a line in the log */
export function platformFindings(config: { migrateFrom?: unknown }): ConfigFinding[] {
  const findings: ConfigFinding[] = [];
  const migrateFrom = config.migrateFrom;
  if (migrateFrom !== undefined && !(typeof migrateFrom === 'string' && OLD_PLATFORMS.has(migrateFrom.trim()))) {
    findings.push({
      level: 'warn',
      text:
        `config: migrateFrom is ${JSON.stringify(migrateFrom)}, which is no platform name of ${OLD_PLUGIN_NAME}. ` +
        'it is "FHEM", or what config.json said for "platform" before. the identities of the accessories are made with it all the same.',
    });
  }
  return findings;
}
