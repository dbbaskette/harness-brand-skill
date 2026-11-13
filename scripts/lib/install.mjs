// Installing Harness Brand. Each release is kept in its own folder of a shared place
// (~/Library/Application Support/Harness Brand on a Mac, else ~/.local/share/harness-brand),
// with `current` pointing at the one in use, as Marketing Studio looks for brand skills; the
// skills folders of Claude Code, Codex and, when it is set up, ~/.agents link to `current`.
// A release is checked before anything points at it, so a failed install changes nothing.
import { spawnSync } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { cpSync, existsSync, lstatSync, mkdirSync, readFileSync, readlinkSync, renameSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { dirname, join, resolve } from 'node:path';

/** What a release holds and an install copies: everything but tests and the old apply-brand skill. */
export const SHIPPED = ['SKILL.md', 'README.md', 'CHANGELOG.md', 'package.json', 'scripts', 'references', 'docs', 'rebrand'];

/** The shared place releases are kept, for this home. */
export function sharedRoot({ home = homedir(), platform = process.platform } = {}) {
  return platform === 'darwin' ? join(home, 'Library', 'Application Support', 'Harness Brand') : join(home, '.local', 'share', 'harness-brand');
}

/** The skills folders Harness Brand is linked into, for this home. CLAUDE_CONFIG_DIR and
 *  CODEX_HOME count only for the person's own home, never for another one. */
export function targets({ home = homedir(), environment = process.env } = {}) {
  const own = resolve(home) === resolve(homedir());
  const list = [
    { label: 'Claude Code', root: join((own && environment.CLAUDE_CONFIG_DIR) || join(home, '.claude'), 'skills', 'harness-brand') },
    { label: 'Codex', root: join((own && environment.CODEX_HOME) || join(home, '.codex'), 'skills', 'harness-brand') },
  ];
  if (existsSync(join(home, '.agents'))) list.push({ label: 'Agents', root: join(home, '.agents', 'skills', 'harness-brand') });
  return list;
}

const packageOf = (folder) => {
  try { return JSON.parse(readFileSync(join(folder, 'package.json'), 'utf8')); } catch { return null; }
};
const linkOf = (place) => {
  try { return lstatSync(place).isSymbolicLink() ? resolve(dirname(place), readlinkSync(place)) : null; } catch { return null; }
};

/** What installing would do to each skills folder: {label, root, action: link|relink|replace|refuse, reason?}. */
export function plan(source, options = {}) {
  const current = join(sharedRoot(options), 'current');
  return targets(options).map((target) => {
    if (!existsSync(target.root) && !linkOf(target.root)) return { ...target, action: 'link' };
    const link = linkOf(target.root);
    if (link) return link === current ? { ...target, action: 'same' } : { ...target, action: 'refuse', reason: `${target.root} links somewhere other than Harness Brand.` };
    if (packageOf(target.root)?.name === 'harness-brand') return { ...target, action: 'replace', reason: 'an earlier copy of Harness Brand' };
    return { ...target, action: 'refuse', reason: `${target.root} holds something other than Harness Brand.` };
  });
}

/** Point `place` at `to`, replacing what is there only once the new link exists. */
function pointAt(place, to) {
  const fresh = join(dirname(place), `.${randomUUID().slice(0, 8)}.link`);
  symlinkSync(to, fresh);
  try {
    if (existsSync(place) && !linkOf(place)) rmSync(place, { recursive: true, force: true });
    renameSync(fresh, place);
  } finally {
    rmSync(fresh, { force: true });
  }
}

/** Install the release in `source`. With `data`, the brands folder is recorded for this home
 *  when none is yet, or when replaceData explicitly selects a different folder. Returns {version, root, steps}. */
export function install(source, { replace = false, data, replaceData = false, log = console.log, ...options } = {}) {
  const version = packageOf(source)?.version;
  if (!/^\d+\.\d+\.\d+$/.test(String(version))) throw new Error(`${source} is not a Harness Brand release: its package.json gives no version.`);
  const steps = plan(source, options);
  const refused = steps.filter((step) => step.action === 'refuse');
  if (refused.length && !replace) throw new Error(`${refused.map((step) => step.reason).join(' ')} Nothing was installed; rerun with --replace to replace it.`);
  const shared = sharedRoot(options);
  const root = join(shared, 'versions', version);
  // Staged under a hidden name, so a stopped install never shows up as a second skill.
  const staging = join(shared, 'versions', `.${version}.${randomUUID().slice(0, 8)}`);
  mkdirSync(dirname(staging), { recursive: true });
  try {
    mkdirSync(staging);
    for (const name of SHIPPED) if (existsSync(join(source, name))) cpSync(join(source, name), join(staging, name), { recursive: true, filter: path => !path.split(/[\\/]/).some(part => ['.venv','.state','__pycache__','runs','tests'].includes(part)) });
    const checked = spawnSync(process.execPath, [join(staging, 'scripts', 'harness-brand.mjs'), 'version'], { encoding: 'utf8', timeout: 30_000 });
    if (checked.status !== 0 || checked.stdout.trim() !== `Harness Brand ${version}`) {
      throw new Error(`The new copy does not run: ${checked.stderr.trim() || checked.stdout.trim() || 'no answer'}.`);
    }
    if (existsSync(root)) rmSync(root, { recursive: true, force: true });
    renameSync(staging, root);
  } finally {
    rmSync(staging, { recursive: true, force: true });
  }
  pointAt(join(shared, 'current'), root);
  log(`Harness Brand ${version} is kept at ${root}.`);
  for (const step of steps) {
    if (step.action === 'same') { log(`${step.label}: ${step.root} already links to it.`); continue; }
    mkdirSync(dirname(step.root), { recursive: true });
    pointAt(step.root, join(shared, 'current'));
    log(`${step.label}: ${step.root} links to it${step.action === 'replace' ? ', in place of an earlier copy' : ''}.`);
  }
  if (data) {
    const pointer = join((options.environment ?? process.env).XDG_CONFIG_HOME || join(options.home ?? homedir(), '.config'), 'harness-brand', 'data');
    if (replaceData || !existsSync(pointer)) {
      mkdirSync(dirname(pointer), { recursive: true });
      const stagedPointer = `${pointer}.${randomUUID()}.tmp`;
      try {
        writeFileSync(stagedPointer, `${resolve(data)}\n`, { mode: 0o600 });
        renameSync(stagedPointer, pointer);
      } finally {
        rmSync(stagedPointer, { force: true });
      }
      log(`The brands folder ${resolve(data)} is recorded in ${pointer}.`);
    }
  }
  return { version, root, steps };
}
