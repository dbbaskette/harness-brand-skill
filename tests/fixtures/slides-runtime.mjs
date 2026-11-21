// A stand-in for an installed Harness Slides: its package and the modules the brand commands use,
// with the same revision and the checks the tests need. It is laid out as Harness Slides 0.19.0
// installs itself, <shared>/versions/<id> with <shared>/current pointing at it, and its guidance
// helper answers as that one does: `runtime` is <shared>/current, and a task resumed on another
// version than it started on carries a one-line `notice`.
import { mkdirSync, mkdtempSync, readdirSync, readlinkSync, realpathSync, renameSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';

const MODULE = `import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
const hash = (bytes) => createHash('sha256').update(bytes).digest('hex');
export function contractRevision(contract) { const { revision, ...data } = contract; return hash(JSON.stringify(data)); }
export function validateBrandContract(contract) {
  if (contract?.schema !== 1 || !contract.identity?.id || !contract.identity?.variant) throw new Error('Use resolved brand contract schema 1 with identity/variant');
  if (!Array.isArray(contract.sources) || !contract.sources.length || contract.sources.some((s) => !/^[a-f0-9]{64}$/.test(s.sha256 ?? ''))) throw new Error('Brand authority needs hashed local sources');
  for (const key of ['canvasPrimary', 'canvasSecondary', 'inkDeep', 'headingPrimary', 'accentAqua']) if (!/^#[0-9a-f]{6}$/i.test(contract.design?.colors?.[key] ?? '')) throw new Error('Missing brand color role: ' + key);
  if (contract.medium.kind === 'blog' && contract.design.slides !== undefined) throw new Error('Blog design must not inherit slide geometry');
  if (contract.revision !== contractRevision(contract)) throw new Error('Brand contract changed; resolve a fresh handoff');
  return contract;
}
export async function checkBrandSources(contract) {
  validateBrandContract(contract);
  for (const source of contract.sources) if (hash(await readFile(source.path)) !== source.sha256) throw new Error('Brand authority changed (' + (source.kind ?? 'source') + '); resolve a fresh contract');
  return { revision: contract.revision, identity: contract.identity, medium: contract.medium, sources: contract.sources.length, status: 'current local sources' };
}
`;

// Written without template strings, so it can sit in one here.
const GUIDANCE = [
  "import { lstatSync, mkdirSync, readFileSync, realpathSync, writeFileSync } from 'node:fs';",
  "import { basename, dirname, join } from 'node:path';",
  "import { fileURLToPath } from 'node:url';",
  "const own = realpathSync(fileURLToPath(new URL('..', import.meta.url)));",
  "const version = JSON.parse(readFileSync(join(own, 'package.json'), 'utf8')).version;",
  "function address(runtime) {",
  "  const actual = realpathSync(runtime), versions = dirname(actual);",
  "  if (basename(versions) !== 'versions') return actual;",
  "  const current = join(dirname(versions), 'current');",
  "  try { if (lstatSync(current).isSymbolicLink() && realpathSync(current) === actual) return current; } catch { /* no pointer */ }",
  "  return actual;",
  "}",
  "const pinOf = (project, task) => join(project, '.harness-slides', 'guidance', 'tasks', String(task), 'pin.json');",
  "export async function start({ project, runtime = own }) {",
  "  mkdirSync(dirname(pinOf(project, 'task-1')), { recursive: true });",
  "  writeFileSync(pinOf(project, 'task-1'), JSON.stringify({ task: 'task-1', revision: 'r1', runtimeVersion: version }));",
  "  return { freshness: 'current-at-start', revision: 'r1', task: 'task-1', guidance: project + '/SKILL.md', runtime: address(runtime), runtimeVersion: version };",
  "}",
  "export async function resume({ project, task, runtime = own }) {",
  "  let pin;",
  "  try { pin = JSON.parse(readFileSync(pinOf(project, task), 'utf8')); } catch { throw new Error('Saved guidance changed; reopen an intact task or start new work.'); }",
  "  const result = { freshness: 'pinned', revision: pin.revision, task, guidance: project + '/SKILL.md', runtime: address(runtime), runtimeVersion: version };",
  "  return pin.runtimeVersion === version ? result : { ...result, startedRuntimeVersion: pin.runtimeVersion,",
  "    notice: 'This work started on runtime ' + pin.runtimeVersion + ' and continues on the installed ' + version + ', with its saved instructions.' };",
  "}",
  '',
].join('\n');

function release(shared, version) {
  const id = `${version}-${Math.random().toString(16).slice(2, 10)}`;
  const root = join(shared, 'versions', id);
  mkdirSync(join(root, 'scripts', 'lib'), { recursive: true });
  writeFileSync(join(root, 'package.json'), JSON.stringify({ name: 'harness-slides', version }));
  writeFileSync(join(root, 'scripts', 'harness-slides.mjs'), '');
  writeFileSync(join(root, 'scripts', 'lib', 'brand-contract.mjs'), MODULE);
  writeFileSync(join(root, 'scripts', 'lib', 'outline.mjs'), 'export async function checkOutline(plan) { if (!Array.isArray(plan?.slides)) throw new Error(\'outline needs slides\'); return plan; }\n');
  writeFileSync(join(root, 'scripts', 'sync-guidance.mjs'), GUIDANCE);
  return id;
}

/** An installed Harness Slides of the given version. Returns its stable address, <shared>/current,
 *  which is what HARNESS_SLIDES_ROOT or a skill link names. */
export function makeSlidesRuntime({ version = '0.19.0' } = {}) {
  const shared = join(realpathSync(mkdtempSync(join(tmpdir(), 'hb-slides-'))), 'Harness Slides');
  symlinkSync(join('versions', release(shared, version)), join(shared, 'current'));
  return join(shared, 'current');
}

/** Update the Harness Slides at `current` as its installer does: a new version folder, the pointer
 *  moved onto it, and every other version folder removed. */
export function updateSlidesRuntime(current, { version }) {
  const shared = dirname(current);
  const id = release(shared, version);
  symlinkSync(join('versions', id), `${current}.new`);
  renameSync(`${current}.new`, current);
  for (const name of readdirSync(join(shared, 'versions'))) if (name !== id) rmSync(join(shared, 'versions', name), { recursive: true });
  return readlinkSync(current);
}
