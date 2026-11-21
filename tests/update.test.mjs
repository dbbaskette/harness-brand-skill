// Nothing is tied to one installed version: the installer keeps one version folder and moves every
// link onto `current`, every path handed out or written into a project names `current`, and work
// saved under one version carries on under the next with the old folder gone. Every install here
// is into a temporary home.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { chmodSync, cpSync, existsSync, lstatSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, readlinkSync, realpathSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { SHIPPED, install, sharedRoot } from '../scripts/lib/install.mjs';
import { findSlides } from '../scripts/lib/worker/slides.mjs';
import { makeBrands } from './fixtures/pack.mjs';
import { makeSlidesRuntime, updateSlidesRuntime } from './fixtures/slides-runtime.mjs';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
const { version: VERSION } = JSON.parse(readFileSync(join(ROOT, 'package.json'), 'utf8'));
const temp = (name) => realpathSync(mkdtempSync(join(tmpdir(), name)));
const sha = (bytes) => createHash('sha256').update(bytes).digest('hex');
const quiet = () => {};
const folders = (place) => readdirSync(place, { withFileTypes: true }).filter((each) => each.isDirectory()).map((each) => each.name);
const node = (env, ...args) => spawnSync(process.execPath, args, { encoding: 'utf8', env: { PATH: process.env.PATH, ...env } });
const json = (done) => { assert.equal(done.status, 0, done.stderr); return JSON.parse(done.stdout); };

/** A release folder of the given version: what a checkout of main holds, without its tests. */
function makeRelease(version) {
  const folder = join(temp('hb-release-'), 'harness-brand');
  for (const name of SHIPPED) {
    cpSync(join(ROOT, name), join(folder, name), { recursive: true,
      filter: (path) => !path.split(/[\\/]/).some((part) => ['.venv', '.state', '__pycache__', 'runs', 'tests'].includes(part)) });
  }
  writeFileSync(join(folder, 'package.json'), JSON.stringify({ ...JSON.parse(readFileSync(join(ROOT, 'package.json'), 'utf8')), version }));
  return folder;
}

/** A home as an install before 1.4.0 left it: version folders named for their versions, an
 *  absolute `current`, and brand shortcut links that lead into a version folder. */
function oldHome() {
  const home = temp('hb-home-');
  const shared = sharedRoot({ home });
  for (const old of ['1.2.3', '1.3.0']) {
    mkdirSync(join(shared, 'versions', old, 'scripts'), { recursive: true });
    writeFileSync(join(shared, 'versions', old, 'package.json'), JSON.stringify({ name: 'harness-brand', version: old }));
    for (const skill of ['true-source-brand', 'tanzu-brand', 'broadcom-brand']) {
      mkdirSync(join(shared, 'versions', old, 'brand-skills', skill), { recursive: true });
      writeFileSync(join(shared, 'versions', old, 'brand-skills', skill, 'SKILL.md'), `# ${skill}\n`);
    }
  }
  symlinkSync(join(shared, 'versions', '1.3.0'), join(shared, 'current'));
  for (const skills of ['.claude/skills', '.codex/skills']) mkdirSync(join(home, skills), { recursive: true });
  return { home, shared };
}

test('the installer leaves one version folder, moves every link that led into an old one onto current, and leaves foreign links alone', () => {
  const { home, shared } = oldHome();
  const elsewhere = temp('hb-elsewhere-');
  const links = {
    '.claude/skills/harness-brand': join(shared, 'current'),
    '.codex/skills/harness-brand': join(shared, 'versions', '1.3.0'),
    '.claude/skills/true-source-brand': join(shared, 'versions', '1.3.0', 'brand-skills', 'true-source-brand'),
    '.codex/skills/true-source-brand': join(shared, 'versions', '1.3.0', 'brand-skills', 'true-source-brand'),
    '.claude/skills/tanzu-brand': join(shared, 'versions', '1.1.0', 'brand-skills', 'tanzu-brand'),   // its folder is already gone
    '.claude/skills/broadcom-brand': join(elsewhere, 'my-broadcom'),                                   // someone else's
    '.claude/skills/another-skill': elsewhere,
  };
  for (const [place, to] of Object.entries(links)) symlinkSync(to, join(home, place));
  mkdirSync(join(home, '.codex', 'skills', 'broadcom-brand'));                                         // a real folder, someone else's
  writeFileSync(join(home, '.codex', 'skills', 'broadcom-brand', 'notes.txt'), 'mine');
  mkdirSync(join(elsewhere, 'kept'));
  symlinkSync(join(elsewhere, 'kept'), join(shared, 'versions', 'linked'));
  // A run made before 1.4.0 without --run-dir kept the person's files inside the version folder.
  mkdirSync(join(shared, 'versions', '1.3.0', 'rebrand', 'runs', 'brand-abc'), { recursive: true });
  writeFileSync(join(shared, 'versions', '1.3.0', 'rebrand', 'runs', 'brand-abc', 'report.md'), '# report');

  const result = install(ROOT, { home, log: quiet });

  const current = join(shared, 'current');
  assert.equal(result.runtime, current);
  assert.equal(result.version, VERSION);
  assert.match(result.versionId, new RegExp(`^${VERSION.replaceAll('.', '\\.')}-[0-9a-f]{8}$`));
  assert.equal(readlinkSync(current), join('versions', result.versionId), 'current is a relative link');
  assert.deepEqual(folders(join(shared, 'versions')), [result.versionId], 'exactly one version folder is left');
  assert.deepEqual(result.removedVersions, ['1.2.3', '1.3.0']);
  assert.deepEqual(result.keptVersions, [{ path: join(shared, 'versions', 'linked'), reason: 'a link, left alone' }]);
  assert.ok(existsSync(join(elsewhere, 'kept')), 'a link in versions/ is not followed');
  for (const place of ['.claude/skills/harness-brand', '.codex/skills/harness-brand']) assert.equal(readlinkSync(join(home, place)), current, place);
  for (const place of ['.claude/skills/true-source-brand', '.codex/skills/true-source-brand']) {
    assert.equal(readlinkSync(join(home, place)), join(current, 'brand-skills', 'true-source-brand'), place);
  }
  assert.equal(readlinkSync(join(home, '.claude/skills/tanzu-brand')), join(current, 'brand-skills', 'tanzu-brand'));
  assert.deepEqual(result.repointed.sort(), ['.claude/skills/tanzu-brand', '.claude/skills/true-source-brand', '.codex/skills/true-source-brand'].map((place) => join(home, place)).sort());
  assert.equal(readlinkSync(join(home, '.claude/skills/broadcom-brand')), join(elsewhere, 'my-broadcom'), 'a foreign link is left alone');
  assert.equal(readlinkSync(join(home, '.claude/skills/another-skill')), elsewhere);
  assert.equal(readFileSync(join(home, '.codex/skills/broadcom-brand/notes.txt'), 'utf8'), 'mine', 'a real folder is left alone');
  assert.deepEqual(result.skipped.map((each) => each.path).sort(), ['.claude/skills/broadcom-brand', '.codex/skills/broadcom-brand'].map((place) => join(home, place)).sort());
  assert.ok(result.skipped.every((each) => /left alone/.test(each.reason)));
  assert.equal(readFileSync(join(shared, 'rebrand-runs', 'brand-abc', 'report.md'), 'utf8'), '# report', 'a run kept in a version folder is moved out before the folder goes');
  assert.equal(node({ HOME: home }, join(home, '.codex/skills/harness-brand/scripts/harness-brand.mjs'), 'version').stdout, `Harness Brand ${VERSION}\n`);

  // Installed again, as an update from main at the same version number is: a new folder, the old one gone.
  const again = install(ROOT, { home, log: quiet });
  assert.notEqual(again.versionId, result.versionId);
  assert.deepEqual(folders(join(shared, 'versions')), [again.versionId]);
  assert.deepEqual(again.removedVersions, [result.versionId]);
  assert.deepEqual(again.steps.map((step) => step.action), ['same', 'same']);
  assert.deepEqual(again.repointed, []);
});

test('nothing is removed when current cannot be moved, and a folder that cannot be removed is reported, not fatal', () => {
  const blocked = oldHome();
  const pointer = join(blocked.shared, 'current');
  spawnSync('rm', [pointer]);
  mkdirSync(pointer);
  writeFileSync(join(pointer, 'notes.txt'), 'not a link');
  assert.throws(() => install(ROOT, { home: blocked.home, log: quiet }), /is not the link Harness Brand keeps there\. Nothing was installed/);
  assert.deepEqual(folders(join(blocked.shared, 'versions')), ['1.2.3', '1.3.0'], 'the earlier versions are untouched and no new folder is left');
  assert.equal(readFileSync(join(pointer, 'notes.txt'), 'utf8'), 'not a link');

  const stuck = oldHome();
  const held = join(stuck.shared, 'versions', '1.2.3', 'held');
  mkdirSync(held);
  writeFileSync(join(held, 'file'), 'x');
  chmodSync(held, 0o500);
  try {
    const result = install(ROOT, { home: stuck.home, log: quiet });
    assert.deepEqual(result.removedVersions, ['1.3.0']);
    assert.deepEqual(result.keptVersions.map((each) => each.path), [join(stuck.shared, 'versions', '1.2.3')]);
    assert.ok(result.keptVersions[0].reason.length > 0);
    assert.equal(realpathSync(join(stuck.shared, 'current')), join(stuck.shared, 'versions', result.versionId));
  } finally {
    chmodSync(held, 0o700);
  }
});

test('the place Harness Slides is found is kept as it is named, never the version folder behind a skill link', () => {
  const home = temp('hb-home-');
  const slides = makeSlidesRuntime();
  mkdirSync(join(home, '.agents', 'skills'), { recursive: true });
  symlinkSync(slides, join(home, '.agents', 'skills', 'harness-slides'));
  assert.deepEqual(findSlides({ home, environment: {} }), { root: join(home, '.agents', 'skills', 'harness-slides'), version: '0.19.0' });
  assert.deepEqual(findSlides({ home, environment: { HARNESS_SLIDES_ROOT: slides } }), { root: slides, version: '0.19.0' });
  const { brands } = makeBrands();
  const report = json(node({ HOME: home, HARNESS_BRAND_DATA: brands }, join(ROOT, 'scripts', 'harness-brand.mjs'), 'doctor', '--json'));
  assert.equal(report.capabilities.find((each) => each.name === 'harness-slides').root, join(home, '.agents', 'skills', 'harness-slides'));
  updateSlidesRuntime(slides, { version: '0.20.0' });
  assert.equal(findSlides({ home, environment: {} }).version, '0.20.0', 'the same place gives the updated Harness Slides');
});

test('the Harness Slides stand-in gives out its stable address and says when work continues on another version', async () => {
  const slides = makeSlidesRuntime({ version: '0.19.0' });
  const project = temp('hb-project-');
  const first = await import(join(slides, 'scripts', 'sync-guidance.mjs'));
  const started = await first.start({ project });
  assert.equal(started.runtime, slides, 'the runtime is <shared>/current');
  assert.equal(started.runtimeVersion, '0.19.0');
  assert.equal((await first.resume({ project, task: started.task })).notice, undefined);
  const before = realpathSync(slides);
  updateSlidesRuntime(slides, { version: '0.20.0' });
  assert.ok(!existsSync(before), 'the version folder the work started on is gone');
  const resumed = json(node({}, '--input-type=module', '-e',
    `const helper = await import(${JSON.stringify(join(slides, 'scripts', 'sync-guidance.mjs'))}); console.log(JSON.stringify(await helper.resume({ project: ${JSON.stringify(project)}, task: 'task-1' })));`));
  assert.equal(resumed.runtime, slides);
  assert.equal(resumed.runtimeVersion, '0.20.0');
  assert.equal(resumed.startedRuntimeVersion, '0.19.0');
  assert.match(resumed.notice, /started on runtime 0\.19\.0 and continues on the installed 0\.20\.0/);
});

/** A brands folder whose example brand also has a rebranding profile with a shortcut, example-brand. */
function withProfile(brands) {
  const files = { 'assets/brand.json': JSON.stringify({ id: 'example', profile: 'assets/example', runtime: {} }), 'assets/icons/library.zip': 'icons',
    'assets/example/brand.json': '{}', 'assets/example/rules.md': 'rules', 'assets/example/template.pptx': 'template', 'references/visual-review.md': 'review',
    'references/entry.json': JSON.stringify({ schema: 1, skill: 'example-brand', name: 'Example Co' }), 'references/SKILL.md': '# Example Co brand\n',
    'references/brand/workflow.md': 'workflow' };
  const manifest = { schema: 1, brand: 'example', files: {} };
  for (const [name, content] of Object.entries(files)) {
    const source = `example/rebrand/source/${name}`;
    mkdirSync(dirname(join(brands, source)), { recursive: true });
    writeFileSync(join(brands, source), content);
    manifest.files[name] = { source, sha256: sha(content) };
  }
  writeFileSync(join(brands, 'example', 'rebrand', 'manifest.json'), JSON.stringify(manifest));
}

const python = spawnSync('python3', ['-c', 'import sys; assert sys.version_info >= (3, 11); print(sys.executable)'], { encoding: 'utf8' });
const PYTHON = python.status === 0 ? python.stdout.trim() : null;

test('work saved under one installed version carries on under the next, with the old folder gone', async () => {
  const home = temp('hb-home-');
  const shared = sharedRoot({ home });
  const current = join(shared, 'current');
  const cli = join(current, 'scripts', 'harness-brand.mjs');
  const { brands } = makeBrands();
  withProfile(brands);
  const slides = makeSlidesRuntime({ version: '0.19.0' });
  const env = { HOME: home, HARNESS_BRAND_DATA: brands, HARNESS_SLIDES_ROOT: slides };
  const run = (...args) => node(env, ...args);
  const installer = (release) => run(join(release, 'scripts', 'install-skill.mjs'), '--research', 'skip', '--rebrand', 'skip');
  // What rebrand setup does, without its network install: the worker's interpreter, the brand's
  // snapshot, and the shortcut. The asset commands need only Python's own library.
  const setUpRebrand = () => {
    mkdirSync(join(current, 'rebrand', '.venv', 'bin'), { recursive: true });
    symlinkSync(PYTHON, join(current, 'rebrand', '.venv', 'bin', 'python3'));
    const snapshot = spawnSync(join(current, 'rebrand', '.venv', 'bin', 'python3'), [join(current, 'rebrand', 'scripts', 'brand_assets.py'), 'install', '--brand', 'example'],
      { encoding: 'utf8', env: { PATH: process.env.PATH, ...env } });
    assert.equal(snapshot.status, 0, snapshot.stderr);
    const linked = run('--input-type=module', '-e', `const { installShortcuts } = await import(${JSON.stringify(join(current, 'scripts', 'rebrand.mjs'))}); installShortcuts(['example']);`);
    assert.equal(linked.status, 0, linked.stderr);
  };

  // --- Under the first version ---------------------------------------------------------------
  const first = installer(makeRelease('1.4.0'));
  assert.equal(first.status, 0, first.stderr);
  const firstFolder = realpathSync(current);
  assert.equal(run(cli, 'version').stdout, 'Harness Brand 1.4.0\n');

  // Helpers run through `current` and through a skill link give out `current`, never the folder behind it.
  const link = join(home, '.claude', 'skills', 'harness-brand', 'scripts', 'harness-brand.mjs');
  for (const command of [cli, link]) assert.equal(json(run(command, 'doctor', '--json')).installation.root, current, command);
  const project = temp('hb-project-');
  const started = run(link, 'guidance', 'start', '--skill', 'slides', '--project', project, '--brand', 'example');
  assert.doesNotMatch(started.stdout, /\/versions\//, 'guidance names no version folder, of Harness Brand or of Harness Slides');
  const guidance = json(started);
  assert.equal(guidance.runtime, slides);
  assert.equal(guidance.notice, undefined);
  assert.equal(guidance.brand.runtime, current);
  assert.equal(guidance.brand.entry, join(current, 'references', 'harness-slides.md'));
  assert.equal(guidance.brand.review, join(current, 'references', 'slide-review.md'));
  for (const command of Object.values(guidance.brand.commands)) assert.ok(command.startsWith(`node "${cli}" `), command);
  assert.ok(guidance.brand.worker.includes(`node "${cli}" icons --brand example`));

  // A contract, and a look sampled but not yet chosen.
  const work = temp('hb-work-');
  const contractFile = join(work, 'contract', 'brand-contract.json');
  const exported = json(run(cli, 'contract', 'export', '--medium', 'slides', '--brand', 'example', '--output', join(work, 'contract')));
  const contractText = readFileSync(contractFile, 'utf8');
  assert.doesNotMatch(contractText, /\/versions\//);
  const contract = JSON.parse(contractText);
  assert.ok(contract.design.references.icons.includes(`node "${cli}" icons --brand example`));
  assert.ok(readFileSync(join(work, 'contract', 'DESIGN.md'), 'utf8').includes(`node "${cli}" layouts --brand example`));
  const outline = join(work, 'outline.json');
  writeFileSync(outline, JSON.stringify({ version: 1, title: 'Deck', slides: [{ id: 'cover_one', kind: 'cover', title: 'Deck' }] }));
  const samples = join(work, 'samples');
  mkdirSync(samples);
  writeFileSync(join(samples, 'brand-contract.json'), contractText);
  const direction = contract.design.slides.deck.directions[0];
  const sample = { id: direction.id, name: direction.name, useWhen: direction.useWhen, direction: direction.direction, layouts: direction.layouts,
    pptx: join(samples, direction.id, 'look.pptx'), build: join(samples, direction.id, 'build-1'), image: null };
  writeFileSync(join(samples, 'looks.json'), JSON.stringify({ schema: 1, status: 'awaiting-choice', identity: contract.identity, contractRevision: contract.revision,
    outlineSha256: sha(readFileSync(outline)), slide: 'cover_one', default: direction.id, house: contract.design.slides.deck.house, samples: [sample] }));

  // Rebranding set up for a brand, with its shortcut.
  if (PYTHON) {
    setUpRebrand();
    for (const skills of ['.claude/skills', '.codex/skills']) assert.equal(readlinkSync(join(home, skills, 'example-brand')), join(current, 'brand-skills', 'example-brand'));
    const alias = join(current, 'brand-skills', 'example-brand');
    assert.equal(readlinkSync(join(alias, '.venv')), join('..', '..', 'rebrand', '.venv'), 'links inside the release are relative');
    assert.equal(readlinkSync(join(alias, 'references', 'rebranding.md')), join('..', '..', '..', 'references', 'rebranding.md'));
    assert.ok(!readlinkSync(join(alias, 'references', 'brand')).startsWith('/'));
    assert.equal(readFileSync(join(home, '.claude/skills/example-brand/references/brand/workflow.md'), 'utf8'), 'workflow');
    const status = run(cli, 'rebrand', 'status', '--brand', 'example');
    assert.doesNotMatch(status.stdout, /\/versions\//);
    assert.ok(json(status).rules.startsWith(join(current, 'rebrand', '.state', 'assets')));
  }

  // --- Harness Slides and Harness Brand are both updated; the folders the work was made with are removed ---
  updateSlidesRuntime(slides, { version: '0.20.0' });
  const second = installer(makeRelease('1.5.0'));
  assert.equal(second.status, 0, second.stderr);
  assert.ok(!existsSync(firstFolder), 'the first version folder is gone');
  assert.equal(folders(join(shared, 'versions')).length, 1);
  assert.equal(run(cli, 'version').stdout, 'Harness Brand 1.5.0\n');
  assert.equal(run(link, 'version').stdout, 'Harness Brand 1.5.0\n');

  // The guidance task resumes on what is installed, and Harness Slides' notice reaches the caller.
  const resumed = json(run(cli, 'guidance', 'resume', '--skill', 'slides', '--project', project, '--task', guidance.task, '--brand', 'example'));
  assert.equal(resumed.runtime, slides);
  assert.equal(resumed.runtimeVersion, '0.20.0');
  assert.match(resumed.notice, /started on runtime 0\.19\.0 and continues on the installed 0\.20\.0/);
  assert.equal(resumed.brand.runtimeVersion, '1.5.0');
  assert.deepEqual(resumed.brand.commands, guidance.brand.commands, 'the commands a caller kept are the commands given now');

  // The contract still checks, exports to the same revision, and the commands written in it still run.
  const checked = json(run(cli, 'contract', 'check', '--file', contractFile));
  assert.equal(checked.status, 'current local sources');
  assert.equal(checked.notice, undefined);
  assert.equal(json(run(cli, 'contract', 'export', '--medium', 'slides', '--brand', 'example', '--output', join(work, 'contract-again'))).revision, exported.revision);
  const [, command, words] = contract.design.references.icons.match(/node "([^"]+)" (icons --brand example --query "<concept>") --data/);
  assert.equal(command, cli);
  const found = json(run(command, ...words.replace('"<concept>"', 'cloud').split(' '), '--json'));
  assert.equal(found.results[0].id, 'example-icons.cloud');

  // The look sampled under the first version is chosen under the second.
  const chosen = json(run(cli, 'look', 'choose', '--samples', samples, '--choice', direction.id, '--words', 'That one', '--unrendered',
    '--outline', outline, '--write', join(work, 'chosen.json')));
  assert.equal(chosen.status, 'chosen');
  assert.deepEqual(JSON.parse(readFileSync(join(work, 'chosen.json'), 'utf8')).direction, direction.direction);
  assert.equal(json(run(cli, 'look', 'status', '--samples', samples)).status, 'chosen');

  // Rebranding: the shortcut links did not move; what the update did not set up says the one command to run.
  if (PYTHON) {
    assert.match(second.stdout, new RegExp(`The brand shortcut example-brand is not set up in this version yet\\. Set it up with: node "${cli.replaceAll('/', '\\/')}" rebrand setup`));
    for (const skills of ['.claude/skills', '.codex/skills']) assert.equal(readlinkSync(join(home, skills, 'example-brand')), join(current, 'brand-skills', 'example-brand'));
    const refused = run(cli, 'rebrand', 'status', '--brand', 'example');
    assert.equal(refused.status, 1);
    assert.ok(refused.stderr.includes(`Set it up with: node "${cli}" rebrand setup`), refused.stderr);
    setUpRebrand();
    assert.equal(readFileSync(join(home, '.codex/skills/example-brand/references/brand/workflow.md'), 'utf8'), 'workflow');
    assert.ok(lstatSync(join(home, '.claude/skills/example-brand/scripts/brand.py')).isFile());
    assert.equal(json(run(cli, 'rebrand', 'status', '--brand', 'example')).brand, 'example');
  }

  // The installer itself runs through `current`: the copy it runs from is replaced under it.
  const through = run(join(current, 'scripts', 'install-skill.mjs'), '--research', 'skip', '--rebrand', 'skip');
  assert.equal(through.status, 0, through.stderr);
  assert.match(through.stdout.trim().split('\n').at(-1), /^Harness Brand 1\.5\.0 is installed for Claude Code, Codex\.$/);
  assert.equal(folders(join(shared, 'versions')).length, 1);
  assert.equal(run(cli, 'version').stdout, 'Harness Brand 1.5.0\n');
});

test('work saved before 1.4.0, which names a version folder, is carried on with commands that work', () => {
  const home = temp('hb-home-');
  const { brands } = makeBrands();
  const env = { HOME: home, HARNESS_BRAND_DATA: brands, HARNESS_SLIDES_ROOT: makeSlidesRuntime() };
  const cli = realpathSync(join(ROOT, 'scripts', 'harness-brand.mjs'));
  const work = temp('hb-work-');
  json(node(env, cli, 'contract', 'export', '--medium', 'slides', '--brand', 'example', '--delivery', 'live', '--output', join(work, 'contract')));
  // The same contract as 1.3.0 wrote it: its commands name the version folder, and the revision covers them.
  const gone = join(home, 'Library', 'Application Support', 'Harness Brand', 'versions', '1.3.0', 'scripts', 'harness-brand.mjs');
  const { revision, ...old } = JSON.parse(readFileSync(join(work, 'contract', 'brand-contract.json'), 'utf8').replaceAll(JSON.stringify(cli).slice(1, -1), gone));
  assert.ok(revision);
  old.revision = sha(JSON.stringify(old));
  const file = join(work, 'old-contract.json');
  writeFileSync(file, JSON.stringify(old));
  const checked = json(node(env, cli, 'contract', 'check', '--file', file));
  assert.equal(checked.status, 'current local sources', 'its content still stands');
  assert.equal(checked.notice, `The commands in this contract name ${gone}, a Harness Brand version that is no longer installed. Export it again: `
    + `node "${cli}" contract export --medium slides --brand example --variant light --delivery live --output NEW_DIR`);

  // Look samples drawn by 1.3.0: the house lines carried into the outline name this Harness Brand.
  const outline = join(work, 'outline.json');
  writeFileSync(outline, JSON.stringify({ version: 1, title: 'Deck', slides: [{ id: 'cover_one', kind: 'cover', title: 'Deck' }] }));
  const samples = join(work, 'samples');
  mkdirSync(samples);
  writeFileSync(join(samples, 'brand-contract.json'), JSON.stringify(old));
  const direction = old.design.slides.deck.directions[0];
  writeFileSync(join(samples, 'looks.json'), JSON.stringify({ schema: 1, status: 'awaiting-choice', identity: old.identity, outlineSha256: sha(readFileSync(outline)),
    slide: 'cover_one', default: direction.id, house: [`Find icons with \`node "${gone}" icons --brand example --query "<concept>" --data "${brands}"\`.`],
    samples: [{ id: direction.id, name: direction.name, useWhen: direction.useWhen, direction: direction.direction, layouts: direction.layouts,
      pptx: join(samples, direction.id, 'look.pptx'), build: join(samples, direction.id, 'build-1'), image: null }] }));
  json(node(env, cli, 'look', 'choose', '--samples', samples, '--choice', direction.id, '--words', 'That one', '--unrendered', '--outline', outline, '--write', join(work, 'chosen.json')));
  const house = JSON.parse(readFileSync(join(work, 'chosen.json'), 'utf8')).house;
  assert.deepEqual(house, [`Find icons with \`node "${cli}" icons --brand example --query "<concept>" --data "${brands}"\`.`]);
  assert.deepEqual(JSON.parse(readFileSync(join(samples, 'choice.json'), 'utf8')).house, house);
});

test('Harness Slides comes from its repository\'s main branch, with a floor on what is installed and nothing pinned', () => {
  const { slides } = JSON.parse(readFileSync(join(ROOT, 'scripts', 'lib', 'harness-install-sources.json'), 'utf8'));
  assert.deepEqual(Object.keys(slides).sort(), ['branch', 'minimumVersion', 'package', 'repository']);
  assert.equal(slides.repository, 'https://github.com/dbbaskette/harness-slides-skill.git');
  assert.equal(slides.branch, 'main');
  assert.match(slides.minimumVersion, /^\d+\.\d+\.\d+$/);
  const home = temp('hb-home-');
  const none = node({ HOME: home }, join(ROOT, 'scripts', 'harness-brand.mjs'), 'guidance', 'start', '--skill', 'slides', '--project', home);
  assert.match(none.stderr, /Install it from https:\/\/github\.com\/dbbaskette\/harness-slides-skill \(its main branch\)/);
  // The floor refuses an older one; any newer one is used, whatever its version.
  const old = makeSlidesRuntime({ version: '0.15.0' });
  mkdirSync(join(home, '.agents', 'skills'), { recursive: true });
  symlinkSync(old, join(home, '.agents', 'skills', 'harness-slides'));
  assert.throws(() => findSlides({ home, environment: {} }), /The installed Harness Slides is 0\.15\.0; Harness Brand needs 0\.15\.1 or later/);
  updateSlidesRuntime(old, { version: '9.9.9' });
  assert.equal(findSlides({ home, environment: {} }).version, '9.9.9');
});
