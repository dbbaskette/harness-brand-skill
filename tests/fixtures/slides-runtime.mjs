// A stand-in for an installed Harness Slides: its package and the brand-contract module the
// brand commands use, with the same revision and the checks the tests need.
import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

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

/** A Harness Slides folder of the given version; returns its path. */
export function makeSlidesRuntime({ version = '0.16.0' } = {}) {
  const root = join(mkdtempSync(join(tmpdir(), 'hb-slides-')), 'harness-slides');
  mkdirSync(join(root, 'scripts', 'lib'), { recursive: true });
  writeFileSync(join(root, 'package.json'), JSON.stringify({ name: 'harness-slides', version }));
  writeFileSync(join(root, 'scripts', 'harness-slides.mjs'), '');
  writeFileSync(join(root, 'scripts', 'lib', 'brand-contract.mjs'), MODULE);
  writeFileSync(join(root, 'scripts', 'lib', 'outline.mjs'), 'export async function checkOutline(plan) { if (!Array.isArray(plan?.slides)) throw new Error(\'outline needs slides\'); return plan; }\n');
  writeFileSync(join(root, 'scripts', 'sync-guidance.mjs'), `export async function start({ project, runtime }) { return { freshness: 'current-at-start', revision: 'r1', task: 'task-1', guidance: project + '/SKILL.md', runtime, runtimeVersion: '${version}' }; }
export async function resume({ project, task, runtime }) { if (task !== 'task-1') throw new Error('Saved guidance changed; reopen an intact task or start new work.'); return { freshness: 'pinned', revision: 'r1', task, guidance: project + '/SKILL.md', runtime, runtimeVersion: '${version}' }; }
`);
  return root;
}
