// what an installation that comes from homebridge-fhem can run into, looked for when homebridge
// starts. everything here only reports: nothing stops the platform or homebridge.
import { readFileSync } from 'node:fs';
import { basename, dirname, join } from 'node:path';
import type { FhemPlatformConfig } from './config.ts';
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

/**
 * What is wrong with how the plugin is installed, for the log. Asked once, when homebridge loads
 * the plugin.
 *
 * Two plugins that register the platform FHEM make homebridge load a platform that is configured
 * as `"platform": "FHEM"` from neither of them. It then starts without the accessories of fhem,
 * and HomeKit forgets them. homebridge only says that the platform was registered twice, so this
 * says what that means and what to do.
 *
 * @param pluginRoot the directory this plugin is installed in
 * @param configPath the config.json of homebridge
 */
export function installationWarnings(pluginRoot: string, configPath: string): string[] {
  const oldPlugin = findOldPlugin(pluginRoot);
  if (oldPlugin === undefined) {
    return [];
  }

  // a config.json that can not be read is taken for one that is affected
  const config = readJson(configPath) as { disabledPlugins?: unknown; platforms?: unknown } | null | undefined;
  if (config) {
    // homebridge itself leaves a disabled plugin out when it looks for the plugin of a platform
    if (Array.isArray(config.disabledPlugins) && config.disabledPlugins.includes(OLD_PLUGIN_NAME)) {
      return [];
    }
    // a platform that names its plugin, as `homebridge-fhem.FHEM`, is loaded from that plugin
    const platforms = Array.isArray(config.platforms) ? (config.platforms as ({ platform?: unknown } | null)[]) : [];
    if (!platforms.some((platform) => platform?.platform === PLATFORM_NAME)) {
      return [];
    }
  }

  return [
    `${OLD_PLUGIN_NAME} is installed as well, in ${oldPlugin}. ` +
      `both plugins register the platform ${PLATFORM_NAME}, and homebridge loads a platform that is configured as "platform": "${PLATFORM_NAME}" from neither of them: ` +
      'it starts without the accessories of fhem, and HomeKit forgets them with their rooms, scenes and automations. ' +
      `stop homebridge, uninstall ${OLD_PLUGIN_NAME} and start homebridge again. ${PLUGIN_NAME} replaces it and reads the same configuration.`,
  ];
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
export function configFindings(config: FhemPlatformConfig): ConfigFinding[] {
  const findings: ConfigFinding[] = [];

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

  // the plugin registers its platform under the name of homebridge-fhem as well, see index.ts
  if (typeof config.platform === 'string' && config.platform.startsWith(OLD_PLUGIN_NAME + '.')) {
    findings.push({
      level: 'info',
      text:
        `config: this platform is configured as "platform": "${config.platform}", which names ${OLD_PLUGIN_NAME}. ${PLUGIN_NAME} answers to that name. ` +
        'leave it as it is: homebridge makes the identity of every accessory from it, and with another name HomeKit takes them all for new ones.',
    });
  }

  return findings;
}
