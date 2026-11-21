// Installing Harness Brand. The release in use is kept in one folder of a shared place
// (~/Library/Application Support/Harness Brand on a Mac, else ~/.local/share/harness-brand),
// <shared>/versions/<id>, with <shared>/current pointing at it, as Marketing Studio looks
// for brand skills; the skills folders of Claude Code, Codex and, when it is set up, ~/.agents
// link to `current`. A release is checked before anything points at it, so a failed install
// changes nothing. Once `current` has moved, every other folder in versions/ is removed and any
// skill link that led into one is moved onto `current`: nothing names a version folder, so an
// update is always the code that runs.
import { spawnSync } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { cpSync, existsSync, lstatSync, mkdirSync, readFileSync, readdirSync, readlinkSync, realpathSync, renameSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { basename, dirname, join, relative, resolve, sep } from 'node:path';

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
/** What a link says, or null when `place` is not a link. */
export const linkOf = (place) => {
  try { return lstatSync(place).isSymbolicLink() ? readlinkSync(place) : null; } catch { return null; }
};
const reasonOf = (error) => String(error.message).split('\n')[0];

/** Where a link at `place` saying `link` leads, in terms of this installation: {to: 'current' |
 *  'version' | 'elsewhere', rest}, `rest` being the path inside the installed release. The link
 *  is judged as written and with its folder resolved, since a home is often reached through a link. */
export function leads(place, link, shared) {
  const written = resolve(dirname(place), link);
  const places = [written];
  try { places.push(join(realpathSync(dirname(written)), basename(written))); } catch { /* A link into a removed folder is judged as written. */ }
  const bases = [shared];
  try { bases.push(realpathSync(shared)); } catch { /* Nothing is installed here yet. */ }
  for (const base of bases) {
    for (const each of places) {
      if (each === join(base, 'current')) return { to: 'current', rest: '' };
      if (each.startsWith(join(base, 'current') + sep)) return { to: 'current', rest: relative(join(base, 'current'), each) };
      if (each.startsWith(join(base, 'versions') + sep)) {
        const [, ...rest] = relative(join(base, 'versions'), each).split(sep);
        return { to: 'version', rest: rest.join(sep) };
      }
    }
  }
  return { to: 'elsewhere', rest: '' };
}

/** What installing would do to each skills folder: {label, root, action: link|same|relink|replace|refuse, reason?}.
 *  A link into one of this installation's own version folders is moved onto `current` (relink). */
export function plan(source, options = {}) {
  const shared = sharedRoot(options);
  return targets(options).map((target) => {
    const link = linkOf(target.root);
    if (link === null && !existsSync(target.root)) return { ...target, action: 'link' };
    if (link !== null) {
      const { to, rest } = leads(target.root, link, shared);
      if (to === 'current' && !rest) return { ...target, action: 'same' };
      if (to === 'version' && !rest) return { ...target, action: 'relink', reason: 'a link to an earlier version folder' };
      return { ...target, action: 'refuse', reason: `${target.root} links somewhere other than Harness Brand.` };
    }
    if (packageOf(target.root)?.name === 'harness-brand') return { ...target, action: 'replace', reason: 'an earlier copy of Harness Brand' };
    return { ...target, action: 'refuse', reason: `${target.root} holds something other than Harness Brand.` };
  });
}

/** Point `place` at `to`, replacing what is there only once the new link exists. */
function pointAt(place, to) {
  const fresh = join(dirname(place), `.${randomUUID().slice(0, 8)}.link`);
  symlinkSync(to, fresh);
  try {
    if (existsSync(place) && linkOf(place) === null) rmSync(place, { recursive: true, force: true });
    renameSync(fresh, place);
  } finally {
    rmSync(fresh, { force: true });
  }
}

/** The names of the brand shortcuts a release folder holds (brand-skills/<name>, made by rebrand setup). */
function shortcutsIn(folder) {
  try {
    return readdirSync(join(folder, 'brand-skills'), { withFileTypes: true }).filter((each) => each.isDirectory()).map((each) => each.name);
  } catch { return []; }
}

/** Before 1.4.0 a rebranding run given no --run-dir kept its report and its Word file inside the
 *  version folder. They are a person's work, so they are moved beside the versions (where runs
 *  are kept now) before the folder goes. Throws when one cannot be moved. */
function keepRuns(folder, shared) {
  const runs = join(folder, 'rebrand', 'runs');
  let names;
  try {
    if (!lstatSync(join(folder, 'rebrand')).isDirectory() || !lstatSync(runs).isDirectory()) return;
    names = readdirSync(runs);
  } catch { return; }
  if (!names.length) return;
  const kept = join(shared, 'rebrand-runs');
  mkdirSync(kept, { recursive: true });
  for (const name of names) {
    const to = existsSync(join(kept, name)) || linkOf(join(kept, name)) !== null ? join(kept, `${name}-${randomUUID().slice(0, 8)}`) : join(kept, name);
    renameSync(join(runs, name), to);
  }
}

/** Remove every folder directly inside this installation's versions/ but `keep`. A link there is
 *  never followed or removed, and a folder that cannot be removed is reported, not fatal. */
function removeOthers(shared, keep) {
  const versions = join(shared, 'versions');
  const removed = [];
  const kept = [];
  if (linkOf(versions) !== null || !lstatSync(versions).isDirectory()) return { removed, kept: [{ path: versions, reason: 'not a real folder; earlier versions were left in place' }] };
  for (const entry of readdirSync(versions, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name))) {
    if (entry.name === keep) continue;
    const path = join(versions, entry.name);
    if (entry.isSymbolicLink()) { kept.push({ path, reason: 'a link, left alone' }); continue; }
    if (!entry.isDirectory()) continue;
    try {
      keepRuns(path, shared);
      rmSync(path, { recursive: true });
      removed.push(entry.name);
    } catch (error) {
      kept.push({ path, reason: reasonOf(error) });
    }
  }
  return { removed, kept };
}

/** Every link in the skills folders that leads into one of this installation's version folders
 *  (a brand shortcut made by rebrand setup before 1.4.0, such as true-source-brand) is moved onto
 *  `current`. A shortcut name that holds anything else is someone else's: left alone, and reported. */
function repointLinks(folders, shared, names) {
  const current = join(shared, 'current');
  const repointed = [];
  const skipped = [];
  const shortcuts = [];
  for (const folder of folders) {
    let entries;
    try { entries = readdirSync(folder).sort(); } catch { continue; }
    for (const name of entries) {
      const path = join(folder, name);
      const link = linkOf(path);
      const found = link === null ? { to: 'elsewhere' } : leads(path, link, shared);
      if (found.to !== 'elsewhere' && found.rest.split(sep)[0] === 'brand-skills') shortcuts.push(path);
      if (found.to === 'version') {
        try {
          pointAt(path, join(current, found.rest));
          repointed.push(path);
        } catch (error) {
          skipped.push({ path, reason: `could not be moved onto ${current}: ${reasonOf(error)}` });
        }
      } else if (found.to === 'elsewhere' && names.has(name)) {
        skipped.push({ path, reason: link === null ? 'a file or folder that Harness Brand did not make; left alone' : `a link to ${link}; left alone` });
      }
    }
  }
  return { repointed, skipped, shortcuts };
}

/** Install the release in `source`. With `data`, the brands folder is recorded for this home
 *  when none is yet, or when replaceData explicitly selects a different folder. Returns
 *  {version, versionId, runtime, steps, repointed, skipped, shortcuts, removedVersions, keptVersions}:
 *  `runtime` is <shared>/current, the address to keep and run from, `versionId` names the folder
 *  behind it, and `shortcuts` are the brand shortcut links, which `rebrand setup` fills in. */
export function install(source, { replace = false, data, replaceData = false, log = console.log, ...options } = {}) {
  const version = packageOf(source)?.version;
  if (!/^\d+\.\d+\.\d+$/.test(String(version))) throw new Error(`${source} is not a Harness Brand release: its package.json gives no version.`);
  const steps = plan(source, options);
  const refused = steps.filter((step) => step.action === 'refuse');
  if (refused.length && !replace) throw new Error(`${refused.map((step) => step.reason).join(' ')} Nothing was installed; rerun with --replace to replace it.`);
  const shared = sharedRoot(options);
  const current = join(shared, 'current');
  const versions = join(shared, 'versions');
  // Each install has a folder of its own, so the same version installed again (the usual case
  // when the release is whatever `main` holds) never rewrites a folder that is in use: the only
  // switch is `current` moving, and the folder it left is then removed.
  const versionId = `${version}-${randomUUID().slice(0, 8)}`;
  const root = join(versions, versionId);
  if (existsSync(current) && linkOf(current) === null) throw new Error(`${current} is not the link Harness Brand keeps there. Nothing was installed; move it aside and install again.`);
  // The shortcuts of the versions about to go, so a shortcut name that now holds something else can be reported.
  const names = new Set();
  try { for (const name of readdirSync(versions)) for (const each of shortcutsIn(join(versions, name))) names.add(each); } catch { /* the first install */ }
  // Staged under a hidden name, so a stopped install never shows up as a second skill.
  const staging = join(versions, `.${versionId}`);
  mkdirSync(versions, { recursive: true });
  try {
    mkdirSync(staging);
    for (const name of SHIPPED) if (existsSync(join(source, name))) cpSync(join(source, name), join(staging, name), { recursive: true, filter: path => !path.split(/[\\/]/).some(part => ['.venv','.state','__pycache__','runs','tests'].includes(part)) });
    const checked = spawnSync(process.execPath, [join(staging, 'scripts', 'harness-brand.mjs'), 'version'], { encoding: 'utf8', timeout: 30_000 });
    if (checked.status !== 0 || checked.stdout.trim() !== `Harness Brand ${version}`) {
      throw new Error(`The new copy does not run: ${checked.stderr.trim() || checked.stdout.trim() || 'no answer'}.`);
    }
    renameSync(staging, root);
  } finally {
    rmSync(staging, { recursive: true, force: true });
  }
  try {
    // A relative link, as Harness Slides and Harness Research keep theirs: the shared place can be moved whole.
    pointAt(current, join('versions', versionId));
    if (realpathSync(current) !== realpathSync(root)) throw new Error(`${current} does not lead to ${root}.`);
  } catch (error) {
    // `current` did not move, so nothing is removed but the copy nothing points at.
    rmSync(root, { recursive: true, force: true });
    throw new Error(`${reasonOf(error)} Nothing was installed.`);
  }
  log(`Harness Brand ${version} is installed at ${current}.`);
  for (const step of steps) {
    if (step.action === 'same') { log(`${step.label}: ${step.root} already links to it.`); continue; }
    mkdirSync(dirname(step.root), { recursive: true });
    pointAt(step.root, current);
    log(`${step.label}: ${step.root} links to it${step.action === 'replace' ? ', in place of an earlier copy' : step.action === 'relink' ? ', in place of a link to an earlier version' : ''}.`);
  }
  // Only now, with `current` on the new release, do the brand shortcuts move onto it and the other versions go.
  const { repointed, skipped, shortcuts } = repointLinks([...new Set(steps.map((step) => dirname(step.root)))], shared, names);
  for (const path of repointed) log(`${path} now links through ${current}.`);
  for (const each of skipped) log(`${each.path}: ${each.reason}.`);
  let removedVersions = [];
  let keptVersions = [];
  try {
    ({ removed: removedVersions, kept: keptVersions } = removeOthers(shared, versionId));
  } catch (error) {
    keptVersions = [{ path: versions, reason: reasonOf(error) }];
  }
  if (removedVersions.length) log(`Removed the earlier version${removedVersions.length === 1 ? '' : 's'} ${removedVersions.join(', ')}.`);
  for (const each of keptVersions) log(`${each.path} was not removed: ${each.reason}.`);
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
  return { version, versionId, runtime: current, steps, repointed, skipped, shortcuts, removedVersions, keptVersions };
}
