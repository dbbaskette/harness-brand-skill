// Optional Python worker for content-preserving rebranding. Brand identity comes only from local profiles.
import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync, symlinkSync, lstatSync, unlinkSync } from 'node:fs';
import { dirname, join, relative, resolve, sep } from 'node:path';
import { parseArgs } from 'node:util';
import { CLI, ROOT, SHARED } from './lib/address.mjs';
import { dataFolder } from './lib/worker/brands.mjs';
import { leads, linkOf, sharedRoot, targets } from './lib/install.mjs';
// ROOT is this Harness Brand's stable address (<shared>/current when installed): the worker is run
// from it and every link made here is written through it, never through a version folder.
const WORKER = join(ROOT, 'rebrand');
const SETUP = `node "${CLI}" rebrand setup`;
const USAGE = 'Usage: harness-brand rebrand setup [--brand ID] [--replace-brand-shortcuts] | run SOURCE --brand ID [--review] [--document ID [--output word|google|both]] | status --brand ID | icons --brand ID search WORDS';

export function profiles(data = dataFolder()) {
  if (!data || !existsSync(data)) return [];
  return readdirSync(data).filter(id => /^[a-z0-9][a-z0-9-]{0,63}$/.test(id) && existsSync(join(data, id, 'rebrand', 'manifest.json'))).sort();
}
function execute(command, args, options = {}) {
  const result = spawnSync(command, args, { stdio: 'inherit', ...options });
  if (result.error || result.status !== 0) throw new Error(`Rebranding command failed${result.error ? `: ${result.error.message}` : ` (exit ${result.status})`}. Existing source files are unchanged; inspect any reported output URL before retrying.`);
  return result;
}
function python() {
  const path = join(WORKER, '.venv', 'bin', 'python3');
  // The runtime is set up for each installed release: after an update that did not, this names the one command.
  if (!existsSync(path)) throw new Error(`Rebranding is not set up for this version of Harness Brand. Set it up with: ${SETUP}`);
  return path;
}
function snapshot(brand) {
  const result = execute(python(), [join(WORKER, 'scripts', 'brand_assets.py'), 'paths', '--brand', brand], { stdio: 'pipe', encoding: 'utf8' });
  return JSON.parse(result.stdout);
}
const managedShortcut = (path, skill) => { try { const meta = JSON.parse(readFileSync(join(path, '.harness-brand-shortcut.json'), 'utf8')); return meta.owner === 'harness-brand' && meta.skill === skill; } catch { return false; } };
const inside = (path) => path === ROOT || path.startsWith(ROOT + sep);
/** What a link at `link` says to reach `target`: a relative path when both are inside this Harness
 *  Brand, so the release folder holds together however it is reached; else the target as given. */
const written = (link, target) => (inside(link) && inside(target) ? relative(dirname(link), target) : target);
/** Whether a link leads into this installation: `current`, or a version folder an update removed. */
const ours = (link) => { const says = linkOf(link); return says !== null && SHARED !== null && [SHARED, sharedRoot()].some((shared) => leads(link, says, shared).to !== 'elsewhere'); };

export function installShortcuts(names, { replace = false } = {}) {
  // Read only verified snapshot metadata; profiles cannot supply executable launcher code.
  const planned = [];
  for (const brand of names) {
    const info = snapshot(brand);
    const entryPath = join(info.snapshot, 'references', 'entry.json');
    if (!existsSync(entryPath)) continue;
    const entry = JSON.parse(readFileSync(entryPath, 'utf8'));
    if (entry.schema !== 1 || !/^[a-z0-9][a-z0-9-]{0,63}-brand$/.test(entry.skill) || entry.skill === 'harness-brand') throw new Error(`Invalid shortcut name for ${brand}.`);
    if (planned.some(p => p.entry.skill === entry.skill)) throw new Error(`Two profiles request the same shortcut: ${entry.skill}`);
    const alias = join(ROOT, 'brand-skills', entry.skill);
    const links = targets().map(t => join(t.root, '..', entry.skill));
    for (const link of links) {
      let stat; try { stat = lstatSync(link); } catch (e) { if (e.code !== 'ENOENT') throw e; }
      // A link into this installation is replaced freely, a dangling one from a removed version included; anything else is someone else's.
      if (stat && linkOf(link) !== alias && !ours(link) && (!stat.isSymbolicLink() || (!replace && !managedShortcut(link, entry.skill)))) {
        throw new Error(`${link} already exists. Preserve any local files; use --replace-brand-shortcuts to replace old shortcut symlinks after migration.`);
      }
    }
    planned.push({ brand, info, entry, alias, links });
  }
  for (const { brand, info, entry, alias, links } of planned) {
    mkdirSync(join(alias, 'scripts'), { recursive: true });
    writeFileSync(join(alias, '.harness-brand-shortcut.json'), JSON.stringify({ owner: 'harness-brand', skill: entry.skill, brand }));
    writeFileSync(join(alias, 'SKILL.md'), readFileSync(join(info.snapshot, 'references', 'SKILL.md')));
    writeFileSync(join(alias, 'scripts', 'brand.py'), `#!/usr/bin/env python3\nimport os,sys\nfrom pathlib import Path\nroot=Path(__file__).resolve().parents[3]\nif '--brand' in sys.argv or any(a.startswith('--brand=') for a in sys.argv):sys.exit('This shortcut fixes its brand; use Harness Brand directly to choose another.')\nentry=root/'rebrand/scripts/brand.py'\npython=root/'rebrand/.venv/bin/python3'\nos.execv(str(python),[str(python),str(entry),'--brand',${JSON.stringify(brand)},*sys.argv[1:]])\n`);
    mkdirSync(join(alias, 'references'), { recursive: true });
    const within = [[join(alias, '.venv'), join(WORKER, '.venv')],
      [join(alias, 'references', 'rebranding.md'), join(ROOT, 'references', 'rebranding.md')],
      [join(alias, 'references', 'brand'), join(info.snapshot, 'references', 'brand')]];
    // The skills folders link to the shortcut through the stable address, so they survive an update
    // (which makes the shortcut again); inside the shortcut, links are relative.
    for (const [link, target] of [...within, ...links.map(link => [link, alias])]) {
      const says = written(link, target);
      if (linkOf(link) === says) continue;
      try { const stat = lstatSync(link); if (!stat.isSymbolicLink()) throw new Error(`Refusing to overwrite ${link}`); unlinkSync(link); } catch (e) { if (e.code !== 'ENOENT') throw e; }
      mkdirSync(dirname(link), { recursive: true });
      symlinkSync(says, link);
    }
    console.log(`${entry.name}: ${entry.skill} uses the shared Harness Brand worker.`);
  }
}

export async function main(args) {
  const [action, ...rest] = args;
  if (!action || ['--help', 'help'].includes(action)) { console.log(USAGE); return 0; }
  if (action === 'setup') {
    const { values } = parseArgs({ args: rest, options: { brand: { type: 'string' }, 'replace-brand-shortcuts': { type: 'boolean', default: false } } });
    const data = dataFolder();
    const names = values.brand ? [values.brand] : profiles(data);
    if (!data || !names.length) throw new Error('No rebranding profiles found. Select a brands folder containing <brand>/rebrand/manifest.json.');
    if (names.some(id => !/^[a-z0-9][a-z0-9-]{0,63}$/.test(id))) throw new Error('Choose a valid brand ID.');
    execute('bash', [join(WORKER, 'setup.sh'), '--data', resolve(data), ...(values.brand ? ['--brand', values.brand] : ['--all'])]);
    installShortcuts(names, { replace: values['replace-brand-shortcuts'] });
    return 0;
  }
  if (action === 'status') {
    execute(python(), [join(WORKER, 'scripts', 'brand_assets.py'), 'paths', ...rest]);
    return 0;
  }
  if (action === 'run') {
    execute(python(), [join(WORKER, 'scripts', 'brand.py'), ...rest]);
    return 0;
  }
  if (['icons', 'review', 'render'].includes(action)) {
    const argv = [...rest]; const at = argv.indexOf('--brand');
    if (at < 0 || !/^[a-z0-9][a-z0-9-]{0,63}$/.test(argv[at+1] ?? '')) throw new Error('Give --brand ID.');
    const brand = argv[at+1]; argv.splice(at, 2);
    const script = { icons: 'brand_icons.py', review: 'visual_review.py', render: 'render.py' }[action];
    execute(python(), [join(WORKER, 'scripts', script), ...argv], { env: { ...process.env, HARNESS_REBRAND_BRAND: brand } });
    return 0;
  }
  throw new Error(USAGE);
}
