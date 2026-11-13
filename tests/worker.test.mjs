import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { BRAND, makeBrands } from './fixtures/pack.mjs';
import { makeSlidesRuntime } from './fixtures/slides-runtime.mjs';

const COMMAND = fileURLToPath(new URL('../scripts/harness-brand.mjs', import.meta.url));
const SLIDES = makeSlidesRuntime();
const home = mkdtempSync(join(tmpdir(), 'hb-home-'));
const run = (env, ...args) => spawnSync(process.execPath, [COMMAND, ...args], { encoding: 'utf8',
  env: { PATH: process.env.PATH, HOME: home, HARNESS_SLIDES_ROOT: SLIDES, ...env } });
const json = (done) => { assert.equal(done.status, 0, done.stderr); return JSON.parse(done.stdout); };
const fresh = () => join(mkdtempSync(join(tmpdir(), 'hb-out-')), 'contract');

test('version prints the name and version on one line', () => {
  assert.match(run({}, 'version').stdout, /^Harness Brand \d+\.\d+\.\d+\n$/);
});

test('brands lists the usable packs, and nothing without a brands folder', () => {
  const { brands } = makeBrands();
  assert.deepEqual(json(run({ HARNESS_BRAND_DATA: brands }, 'brands', '--json')),
    [{ brand: 'example', name: 'Example Co', variants: ['light'], slides: true }]);
  const none = run({}, 'brands', '--json');
  assert.equal(none.status, 1);
  assert.match(none.stderr, /^Harness Brand has no brands folder\. Set HARNESS_BRAND_DATA/);
  assert.equal(none.stdout, '');
  assert.match(run({}, 'brands').stdout, /Harness Brand has no brands folder\. Set HARNESS_BRAND_DATA/);
  const empty = mkdtempSync(join(tmpdir(), 'hb-empty-'));
  assert.match(run({ HARNESS_BRAND_DATA: empty }, 'brands', '--json').stderr, /holds no brand pack that passes pack check/);
  assert.deepEqual(json(run({}, '--data', brands, 'brands', '--json')).map((each) => each.brand), ['example']);
});

test('a pack that does not pass is never listed or used, and says why', () => {
  const { brands } = makeBrands({ files: { 'guide.md': '# Example Co\n' } });
  const listed = run({ HARNESS_BRAND_DATA: brands }, 'brands', '--json');
  assert.equal(listed.status, 1);
  assert.match(listed.stderr, /holds no brand pack that passes pack check\. example: guide\.md has no "## Brand rules" section\./);
  assert.match(run({ HARNESS_BRAND_DATA: brands }, 'brands').stdout, /example: not usable: guide\.md has no "## Brand rules" section\./);
  const done = run({ HARNESS_BRAND_DATA: brands }, 'contract', 'export', '--brand', 'example', '--output', fresh());
  assert.equal(done.status, 1);
  assert.match(done.stderr, /holds no brand pack that passes pack check/);
});

test('contract export writes the slides contract, DESIGN.md, VOICE.md and deck-direction.json, and check passes it', () => {
  const { brands, pack } = makeBrands();
  const output = fresh();
  const said = json(run({ HARNESS_BRAND_DATA: brands }, 'contract', 'export', '--medium', 'slides', '--brand', 'Example Co',
    '--delivery', 'live', '--output', output));
  assert.deepEqual(Object.keys(said), ['output', 'revision', 'identity', 'medium', 'authorVoice', 'deckDirection', 'defaultDirection']);
  assert.equal(said.defaultDirection, 'example-clear');
  const contract = JSON.parse(readFileSync(join(output, 'brand-contract.json'), 'utf8'));
  assert.deepEqual(contract.identity, { id: 'example', name: 'Example Co', variant: 'light' });
  assert.deepEqual(contract.medium, { kind: 'slides', delivery: 'live' });
  assert.equal(contract.design.colors.headingPrimary, '#005C8A');
  assert.equal(contract.design.slides.typography.code.size, 24, 'code takes the live body size');
  assert.equal(contract.design.slides.typography.code.fontFamily, 'Courier New');
  assert.equal(contract.design.nativeTemplate.layoutPart, 'ppt/slideLayouts/slideLayout2.xml');
  assert.equal(contract.design.nativeTemplate.path, join(pack, 'templates', 'light.pptx'));
  assert.deepEqual(contract.sources.map((each) => each.kind), ['brand', 'tokens', 'brand policy', 'layouts', 'native template', 'deck directions', 'icon library', 'icon index']);
  assert.equal(contract.design.slides.deck.closing.withWords.layout, 'Title Only');
  for (const file of ['DESIGN.md', 'VOICE.md', 'deck-direction.json']) assert.ok(existsSync(join(output, file)), file);
  assert.match(readFileSync(join(output, 'DESIGN.md'), 'utf8'), /^# Example Co design · slides\n\nContract revision: [0-9a-f]{64}/);
  assert.match(readFileSync(join(output, 'DESIGN.md'), 'utf8'), new RegExp(`node "[^"]+harness-brand\\.mjs" layouts --brand example --variant light --data "${brands}"`));
  assert.equal(JSON.parse(readFileSync(join(output, 'deck-direction.json'), 'utf8')).contractRevision, contract.revision);
  const checked = json(run({}, 'contract', 'check', '--file', join(output, 'brand-contract.json')));
  assert.equal(checked.status, 'current local sources');
  writeFileSync(join(pack, 'guide.md'), `${readFileSync(join(pack, 'guide.md'), 'utf8')}\nMore.\n`);
  const changed = run({}, 'contract', 'check', '--file', join(output, 'brand-contract.json'));
  assert.equal(changed.status, 1);
  assert.match(changed.stderr, /Brand authority changed \(brand policy\); resolve a fresh contract/);
});

test('a blog contract has no slides, records a voice profile, and is always for reading', () => {
  const { brands } = makeBrands();
  const voice = join(mkdtempSync(join(tmpdir(), 'hb-voice-')), 'voice.json');
  writeFileSync(voice, JSON.stringify({ id: 'dan', revision: null, guide: 'Short sentences.', status: 'provisional' }), { mode: 0o600 });
  const output = fresh();
  const said = json(run({ HARNESS_BRAND_DATA: brands }, 'contract', 'export', '--medium', 'blog', '--brand', 'example',
    '--variant', 'light', '--voice-profile', voice, '--output', output));
  assert.equal(said.authorVoice, 'provisional');
  const contract = JSON.parse(readFileSync(join(output, 'brand-contract.json'), 'utf8'));
  assert.equal(contract.design.slides, undefined);
  assert.equal(contract.medium.delivery, 'reading');
  assert.equal(contract.language.authorVoice.guide, 'Short sentences.');
  assert.equal(contract.sources.at(-1).kind, 'selected author voice');
  assert.match(readFileSync(join(output, 'VOICE.md'), 'utf8'), /Author voice status: provisional\.\n\nShort sentences\./);
  assert.ok(!existsSync(join(output, 'deck-direction.json')));
  writeFileSync(voice, JSON.stringify({ id: 'dan', guide: 'x', status: 'maybe' }));
  const refused = run({ HARNESS_BRAND_DATA: brands }, 'contract', 'export', '--medium', 'blog', '--brand', 'example', '--voice-profile', voice, '--output', fresh());
  assert.match(refused.stderr, /Portable voice needs id, guide and explicit provisional\|confirmed status/);
});

test('contract refusals are one sentence each, and write nothing', () => {
  const { brands } = makeBrands();
  const env = { HARNESS_BRAND_DATA: brands };
  const cases = [
    [['contract', 'export', '--brand', 'nosuch', '--output', fresh()], /^Unknown brand: nosuch\. Choose Example Co\.$/],
    [['contract', 'export', '--brand', 'example', '--variant', 'dark', '--output', fresh()], /^Unknown example variant: dark\. Choose light\.$/],
    [['contract', 'export', '--brand', 'example', '--medium', 'video', '--output', fresh()], /^Choose medium slides\|blog and delivery live\|reading$/],
    [['contract', 'export', '--brand', 'example'], /^Choose a new output directory$/],
    [['contract', 'export', '--brand', 'example', '--colour', 'red', '--output', fresh()], /^Unsupported contract option$/],
    [['contract'], /^Use contract export\|check$/],
  ];
  for (const [args, expected] of cases) {
    const done = run(env, ...args);
    assert.equal(done.status, 1, args.join(' '));
    assert.match(done.stderr.trim(), expected);
    assert.equal(done.stdout, '');
  }
  const there = fresh();
  mkdirSync(there);
  assert.match(run(env, 'contract', 'export', '--brand', 'example', '--output', there).stderr, /something else is already there|EEXIST/);
});

test('without Harness Slides a contract cannot be made, and says how to get it', () => {
  const { brands } = makeBrands();
  const done = spawnSync(process.execPath, [COMMAND, 'contract', 'export', '--brand', 'example', '--output', fresh()],
    { encoding: 'utf8', env: { PATH: process.env.PATH, HOME: home, HARNESS_BRAND_DATA: brands } });
  assert.equal(done.status, 1);
  assert.match(done.stderr, /needs Harness Slides 0\.15\.1 or later, and none is installed/);
});

test('doctor reports what is ready as JSON, Arial among it, and fails when something needed is missing', () => {
  const { brands } = makeBrands();
  const ready = run({ HARNESS_BRAND_DATA: brands }, 'doctor', '--profile', 'presentation', '--format', 'pptx', '--json');
  const report = JSON.parse(ready.stdout);
  assert.equal(report.ok, true);
  assert.equal(ready.status, 0);
  assert.ok(report.capabilities.some((each) => each.name === 'arial' && ['available', 'missing'].includes(each.status)));
  const missing = run({}, 'doctor', '--profile', 'presentation', '--format', 'pptx', '--json');
  assert.equal(missing.status, 1);
  assert.equal(JSON.parse(missing.stdout).ok, false);
});

test('layouts lists a brand\'s searchable layouts and finds one by name', () => {
  const brand = structuredClone(BRAND);
  const { brands, pack } = makeBrands({ brand });
  const index = JSON.parse(readFileSync(join(pack, 'layouts.json'), 'utf8'));
  index.variants.light.layouts[2].searchable = false;
  index.variants.light.layouts[1].searchTerms = ['one big idea'];
  writeFileSync(join(pack, 'layouts.json'), JSON.stringify(index));
  // The template and the layouts changed under a pack never sealed, so it still passes.
  const listed = json(run({ HARNESS_BRAND_DATA: brands }, 'layouts', '--brand', 'example', '--json'));
  assert.deepEqual(listed.layouts.map((each) => each.name), ['Title Slide', 'Title Only ']);
  assert.deepEqual(json(run({ HARNESS_BRAND_DATA: brands }, 'layouts', '--brand', 'example', '--query', 'big idea', '--json')).layouts
    .map((each) => each.name), ['Title Only ']);
  assert.equal(json(run({ HARNESS_BRAND_DATA: brands }, 'layouts', '--brand', 'example', '--id', 'Blank', '--json')).layouts.length, 1);
});

test('a brand for writing only gives blog contracts and refuses slides in a sentence', () => {
  const brand = structuredClone(BRAND);
  delete brand.variants.light.slides;
  brand.icons = [];
  const { brands } = makeBrands({ brand, files: { 'templates/light.pptx': null, 'layouts.json': null, 'directions.json': null, 'audit.json': null,
    'guide.md': '# Example Co\n\n## Brand rules\n\nIn full.\n\n## Voice and naming\n\nPlain.\n' } });
  const env = { HARNESS_BRAND_DATA: brands };
  assert.deepEqual(json(run(env, 'brands', '--json'))[0].slides, false);
  assert.equal(run(env, 'contract', 'export', '--medium', 'blog', '--brand', 'example', '--output', fresh()).status, 0);
  const slides = run(env, 'contract', 'export', '--medium', 'slides', '--brand', 'example', '--output', fresh());
  assert.match(slides.stderr.trim(), /^The Example Co brand has no slides: its light variant has no template\.$/);
});

test('brands lists the default variant first, and a bare option is refused in a sentence', () => {
  const brand = structuredClone(BRAND);
  brand.variants = { dark: { theme: 'dark', colors: structuredClone(BRAND.variants.light.colors) }, light: BRAND.variants.light };
  const { brands } = makeBrands({ brand });
  assert.deepEqual(json(run({ HARNESS_BRAND_DATA: brands }, 'brands', '--json'))[0].variants, ['light', 'dark']);
  const bare = run({ HARNESS_BRAND_DATA: brands }, 'contract', 'export', '--brand', 'example', '--output');
  assert.match(bare.stderr.trim(), /^Give a value for --output\.$/);
});

test('data --set records the brands folder for studios that pass no environment', () => {
  const { brands } = makeBrands();
  const config = mkdtempSync(join(tmpdir(), 'hb-config-'));
  const set = run({ XDG_CONFIG_HOME: config }, 'data', '--set', brands, '--json');
  assert.deepEqual(json(set).usable, ['example']);
  assert.equal(readFileSync(join(config, 'harness-brand', 'data'), 'utf8'), `${brands}\n`);
  assert.deepEqual(json(run({ XDG_CONFIG_HOME: config }, 'brands', '--json')).map((each) => each.brand), ['example']);
  assert.match(run({ XDG_CONFIG_HOME: config }, 'data', '--set', join(config, 'nowhere')).stderr, /There is no folder at/);
});

test('data --install copies brands into the local brands folder, which is read when nothing else names one', () => {
  const { brands } = makeBrands();
  const own = mkdtempSync(join(tmpdir(), 'hb-local-'));
  const env = { HOME: own, XDG_CONFIG_HOME: join(own, '.config') };
  const none = run(env, 'brands');
  assert.match(none.stdout + none.stderr, /data --install FOLDER/);
  mkdirSync(join(brands, 'notes'));
  const installed = json(run(env, 'data', '--install', brands, '--json'));
  assert.deepEqual(installed.installed, ['example', 'icon-libraries']);
  assert.equal(installed.folder, installed.local);
  assert.equal(installed.from, 'local');
  assert.ok(!existsSync(join(installed.local, 'notes')));
  assert.deepEqual(json(run(env, 'brands', '--json')).map((each) => each.brand), ['example']);
  writeFileSync(join(installed.local, 'example', 'stale.txt'), 'old');
  json(run(env, 'data', '--install', brands, '--json'));
  assert.ok(!existsSync(join(installed.local, 'example', 'stale.txt')));
  assert.deepEqual(readdirSync(installed.local).sort(), ['example', 'icon-libraries']);
  assert.match(run(env, 'data', '--install', join(own, 'notes')).stderr, /There is no folder at/);
  assert.match(run(env, 'data', '--install', join(brands, 'notes')).stderr, /holds no brands/);
});

// The installed Harness Slides, when this computer has one: the contract must be one it accepts.
const installed = [join(process.env.HOME ?? '', '.claude', 'skills', 'harness-slides'), join(process.env.HOME ?? '', '.agents', 'skills', 'harness-slides')]
  .find((place) => existsSync(join(place, 'scripts', 'lib', 'brand-contract.mjs')));
test('the installed Harness Slides accepts the slides and blog contracts', { skip: !installed && 'no Harness Slides installed' }, async () => {
  const { brands } = makeBrands();
  const { validateBrandContract } = await import(join(installed, 'scripts', 'lib', 'brand-contract.mjs'));
  for (const medium of ['slides', 'blog']) {
    const output = fresh();
    const done = spawnSync(process.execPath, [COMMAND, 'contract', 'export', '--medium', medium, '--brand', 'example', '--output', output],
      { encoding: 'utf8', env: { PATH: process.env.PATH, HOME: home, HARNESS_SLIDES_ROOT: installed, HARNESS_BRAND_DATA: brands } });
    assert.equal(done.status, 0, done.stderr);
    assert.doesNotThrow(() => validateBrandContract(JSON.parse(readFileSync(join(output, 'brand-contract.json'), 'utf8')), { medium }));
  }
});
