import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { makeBrands } from './fixtures/pack.mjs';

const COMMAND = fileURLToPath(new URL('../scripts/harness-brand.mjs', import.meta.url));
const run = (...args) => spawnSync(process.execPath, [COMMAND, ...args], { encoding: 'utf8' });
const read = (pack, file) => JSON.parse(readFileSync(join(pack, file), 'utf8'));

test('pack check tells a brand pack from an icon library, and passes Example Co', () => {
  const { brands, pack } = makeBrands();
  const done = run('pack', 'check', pack);
  assert.equal(done.status, 0, done.stdout + done.stderr);
  assert.equal(done.stdout.trim(), 'Example Co passes: 1 variant, 1 with slides; not sealed yet.');
  assert.match(run('pack', 'check', join(brands, 'icon-libraries', 'example-icons')).stdout, /Example icons passes: 2 glyph icons/);
  const nothing = run('pack', 'check', mkdtempSync(join(tmpdir(), 'hb-empty-')));
  assert.equal(nothing.status, 1);
  assert.match(nothing.stderr, /is neither an icon library \(it has no library\.zip\) nor a brand pack \(it has no brand\.json\)/);
});

test('pack check names every problem and fails', () => {
  const { pack } = makeBrands({ files: { 'guide.md': '# Example Co\n', 'audit.json': null } });
  const done = run('pack', 'check', pack);
  assert.equal(done.status, 1);
  assert.match(done.stdout, /does not pass:\n {2}guide\.md has no "## Brand rules" section\./);
  assert.match(done.stdout, /The pack has slides but no audit\.json\./);
  const json = JSON.parse(run('pack', 'check', pack, '--json').stdout);
  assert.equal(json.ok, false);
  assert.ok(json.problems.length >= 4);
});

test('pack scaffold drafts the judgement files, and will not replace them unless told to', () => {
  const { pack } = makeBrands();
  for (const file of ['brand.json', 'guide.md', 'directions.json', 'audit.json']) rmSync(join(pack, file));
  const done = run('pack', 'scaffold', pack, '--icons', 'example-icons');
  assert.equal(done.status, 0, done.stderr);
  assert.match(done.stdout, /^Drafted brand\.json, guide\.md, directions\.json, audit\.json in /);
  assert.match(done.stdout, /Then remove "draft" from brand\.json\./);
  const brand = read(pack, 'brand.json');
  assert.equal(brand.id, 'example');
  assert.equal(brand.name, 'Example Co');
  assert.equal(brand.icons[0].library, 'example-icons');
  assert.match(run('pack', 'check', pack).stdout, /brand\.json is still a draft/);
  const before = readFileSync(join(pack, 'brand.json'));
  const again = run('pack', 'scaffold', pack);
  assert.equal(again.status, 1);
  assert.deepEqual(readFileSync(join(pack, 'brand.json')), before, 'a refused scaffold writes nothing');
  assert.match(again.stderr, /already has brand\.json, guide\.md, directions\.json, audit\.json\. Give --replace/);
  const replaced = run('pack', 'scaffold', pack, '--replace', '--name', 'Example Company', '--json');
  assert.equal(JSON.parse(replaced.stdout).written.length, 4);
  assert.equal(read(pack, 'brand.json').name, 'Example Company');
  assert.match(run('pack', 'scaffold', mkdtempSync(join(tmpdir(), 'hb-bare-'))).stderr, /has no tokens\.json\. Make it first with pack tokens/);
});

test('pack seal writes the hashes once the pack passes, and a later change is caught', () => {
  const { pack } = makeBrands();
  const done = run('pack', 'seal', pack);
  assert.equal(done.status, 0, done.stderr);
  assert.match(done.stdout, /^Sealed 8 pack files and 2 sources in /);
  assert.equal(Object.keys(read(pack, 'brand.json').files).length, 8);
  assert.match(run('pack', 'check', pack).stdout, /passes: 1 variant, 1 with slides; sealed\./);
  writeFileSync(join(pack, 'guide.md'), `${readFileSync(join(pack, 'guide.md'), 'utf8')}\nMore.\n`);
  assert.match(run('pack', 'check', pack).stdout, /guide\.md has changed since the pack was sealed\. Seal it again\./);
  assert.equal(run('pack', 'seal', pack).status, 0);
  assert.equal(run('pack', 'check', pack).status, 0);
  writeFileSync(join(pack, 'guide.md'), '# Example Co\n');
  const before = readFileSync(join(pack, 'brand.json'));
  const refused = run('pack', 'seal', pack);
  assert.equal(refused.status, 1);
  assert.deepEqual(readFileSync(join(pack, 'brand.json')), before, 'a refused seal writes nothing');
  assert.match(refused.stderr, /does not pass, so it was not sealed/);
});
