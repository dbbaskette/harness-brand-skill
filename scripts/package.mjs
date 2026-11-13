#!/usr/bin/env node
// Package a release: harness-brand-<version>-mac.zip, with the skill folder harness-brand/ at its
// root, and harness-brand-<version>-mac.zip.sha256 beside it ("<sha256>  <zip name>"), as Marketing
// Studio's installer downloads and checks them.
import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, readdirSync, readFileSync, realpathSync, statSync, writeFileSync } from 'node:fs';
import { join, relative, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseArgs } from 'node:util';
import { sha256 } from './lib/pack/check.mjs';
import { SHIPPED } from './lib/install.mjs';
import { writeZip } from './lib/zip.mjs';
import { VERSION } from './version.mjs';

const ROOT = fileURLToPath(new URL('..', import.meta.url));

/** Every shipped file, as [path inside the release, absolute path], in a stable order: the files
 *  Git tracks when this is a Git checkout, so nothing stray is shipped. */
export function releaseFiles(root = ROOT) {
  const tracked = spawnSync('git', ['ls-files', '-z', '--', ...SHIPPED], { cwd: root, encoding: 'utf8' });
  if (tracked.status === 0 && tracked.stdout) {
    return tracked.stdout.split('\0').filter(path => path && !path.split('/').some(part => ['.venv','.state','__pycache__','runs','tests'].includes(part))).sort().map((path) => [path, join(root, path)]);
  }
  const found = [];
  const walk = (place) => {
    if (statSync(place).isDirectory()) {
      for (const name of readdirSync(place).sort()) if (!name.startsWith('.') && !['__pycache__','runs','tests'].includes(name)) walk(join(place, name));
    } else {
      found.push([relative(root, place).split(sep).join('/'), place]);
    }
  };
  for (const name of SHIPPED) if (existsSync(join(root, name))) walk(join(root, name));
  return found;
}

export function main(args) {
  const { values } = parseArgs({ args, options: { output: { type: 'string', default: join(ROOT, 'dist') } } });
  const output = resolve(values.output);
  mkdirSync(output, { recursive: true });
  const name = `harness-brand-${VERSION}-mac.zip`;
  const archive = writeZip(releaseFiles().map(([path, place]) => [`harness-brand/${path}`, readFileSync(place)]));
  writeFileSync(join(output, name), archive);
  writeFileSync(join(output, `${name}.sha256`), `${sha256(archive)}  ${name}\n`);
  console.log(JSON.stringify({ version: VERSION, zip: join(output, name), sha256: sha256(archive), files: releaseFiles().length }, null, 2));
  return 0;
}

if (process.argv[1] && realpathSync(resolve(process.argv[1])) === realpathSync(fileURLToPath(import.meta.url))) process.exitCode = main(process.argv.slice(2));
