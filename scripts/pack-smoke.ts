// packs the plugin, installs the tarball with npm into an empty directory and imports it with
// node. this is how homebridge installs and loads a plugin, so it catches a package that is
// missing files or that fails to load on the running node version.
import { execFileSync } from 'node:child_process';
import { mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const root = join(import.meta.dirname, '..');
const pkg = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8')) as { name: string };
const name = pkg.name;

const work = mkdtempSync(join(tmpdir(), 'pack-smoke-'));
try {
  execFileSync('bun', ['pm', 'pack', '--destination', work], { cwd: root, stdio: 'inherit' });
  const tarball = readdirSync(work).find((file) => file.endsWith('.tgz'));
  if (tarball === undefined) {
    throw new Error('bun pm pack did not produce a tarball');
  }

  writeFileSync(join(work, 'package.json'), JSON.stringify({ name: 'pack-smoke', private: true }));
  execFileSync('npm', ['install', '--no-audit', '--no-fund', '--loglevel=error', join(work, tarball)], { cwd: work, stdio: 'inherit' });

  // the plugin has to export the function homebridge calls to register it. the process is
  // ended explicitly because loading the plugin may leave a server listening.
  const check = `
    const plugin = await import(${JSON.stringify(name)});
    const initializer = typeof plugin.default === 'function' ? plugin.default : plugin.default?.default;
    if (typeof initializer !== 'function') {
      console.error('the plugin does not export an initializer function');
      process.exit(1);
    }
    process.exit(0);
  `;
  execFileSync('node', ['--input-type=module', '-e', check], { cwd: work, stdio: 'inherit' });
  console.log(`pack-smoke: ${name} installs and loads on node ${process.version}`);
} finally {
  rmSync(work, { recursive: true, force: true });
}
