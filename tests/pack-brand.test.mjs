import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { writeZip } from '../scripts/lib/zip.mjs';
import { makeTemplate } from './fixtures/template.mjs';

const COMMAND = fileURLToPath(new URL('../scripts/harness-brand.mjs', import.meta.url));
const run = (...args) => spawnSync(process.execPath, [COMMAND, ...args], { encoding: 'utf8' });

function place() {
  const root = mkdtempSync(join(tmpdir(), 'hb-pack-'));
  writeFileSync(join(root, 'template.pptx'), makeTemplate());
  writeFileSync(join(root, 'export.zip'), writeZip([['export/tokens.json', JSON.stringify({ name: 'Example Co',
    color: { themes: [{ id: 'light' }], tokens: [{ name: 'blue', value: '#005c8a' }] } })]]));
  return root;
}

test('pack tokens writes tokens.json, and will not replace it unless told to', () => {
  const root = place();
  const pack = join(root, 'example', 'pack');
  const done = run('pack', 'tokens', join(root, 'export.zip'), '--into', pack);
  assert.equal(done.status, 0, done.stderr);
  assert.match(done.stdout, /1 colours \(0 with a dark value\)/);
  assert.equal(JSON.parse(readFileSync(join(pack, 'tokens.json'), 'utf8')).colors[0].light, '#005c8a');
  const again = run('pack', 'tokens', join(root, 'export.zip'), '--into', pack);
  assert.equal(again.status, 1);
  assert.match(again.stderr, /already has a tokens\.json/);
  assert.equal(run('pack', 'tokens', join(root, 'export.zip'), '--into', pack, '--replace').status, 0);
});

test('pack measure copies the template and writes layouts.json, naming the masters it left out', () => {
  const root = place();
  const pack = join(root, 'example', 'pack');
  const done = run('pack', 'measure', join(root, 'template.pptx'), '--variant', 'light', '--into', pack);
  assert.equal(done.status, 0, done.stderr);
  assert.match(done.stdout, /as light: 960 × 540 pt, master 2, 3 layouts \(2 with an example slide\), 3 slides \(1 hidden\)/);
  assert.match(done.stdout, /Not measured: master 1 \(1 layout, no slides\)\. Give --master to choose another\./);
  assert.deepEqual(readFileSync(join(pack, 'templates', 'light.pptx')), readFileSync(join(root, 'template.pptx')));
  const layouts = JSON.parse(readFileSync(join(pack, 'layouts.json'), 'utf8'));
  assert.equal(layouts.variants.light.layouts.length, 3);
  const again = run('pack', 'measure', join(root, 'template.pptx'), '--variant', 'light', '--into', pack);
  assert.equal(again.status, 1);
  assert.match(again.stderr, /already has templates\/light\.pptx\. Give --replace/);
  const json = run('pack', 'measure', join(root, 'template.pptx'), '--variant', 'light', '--into', pack, '--replace', '--json');
  assert.equal(JSON.parse(json.stdout).used, 2);
});

test('pack measure refuses what it cannot measure, and writes nothing', () => {
  const root = place();
  const pack = join(root, 'example', 'pack');
  const done = run('pack', 'measure', join(root, 'export.zip'), '--variant', 'light', '--into', pack);
  assert.equal(done.status, 1);
  assert.match(done.stderr, /not a PowerPoint presentation/);
  assert.ok(!existsSync(pack));
  assert.match(run('pack', 'measure', join(root, 'template.pptx'), '--into', pack).stderr, /Give --variant and --into/);
});

test('pack previews says what it needs when it cannot draw', () => {
  const root = place();
  const pack = join(root, 'example', 'pack');
  run('pack', 'measure', join(root, 'template.pptx'), '--variant', 'light', '--into', pack);
  writeFileSync(join(root, 'not-a-program'), 'text');
  const done = run('pack', 'previews', pack, '--variant', 'light', '--soffice', join(root, 'not-a-program'));
  assert.equal(done.status, 1);
  assert.match(done.stderr, /not-a-program is not a program that can be run/);
  assert.match(run('pack', 'previews', pack).stderr, /Give --variant/);
});

test('a measure that cannot write both files changes neither', () => {
  const root = place();
  const pack = join(root, 'example', 'pack');
  assert.equal(run('pack', 'measure', join(root, 'template.pptx'), '--variant', 'light', '--into', pack).status, 0);
  const template = readFileSync(join(pack, 'templates', 'light.pptx'));
  const layouts = readFileSync(join(pack, 'layouts.json'));
  mkdirSync(join(pack, 'layouts.json.tmp'));   // a folder where the new layouts.json would be written
  writeFileSync(join(root, 'other.pptx'), makeTemplate({ tricky: true }));
  const done = run('pack', 'measure', join(root, 'other.pptx'), '--variant', 'light', '--into', pack, '--replace');
  assert.equal(done.status, 1);
  assert.deepEqual(readFileSync(join(pack, 'templates', 'light.pptx')), template);
  assert.deepEqual(readFileSync(join(pack, 'layouts.json')), layouts);
  assert.ok(!existsSync(join(pack, 'templates', 'light.pptx.tmp')));
});

test('a layouts.json this command cannot read is refused, never replaced', () => {
  const root = place();
  const pack = join(root, 'example', 'pack');
  mkdirSync(pack, { recursive: true });
  for (const body of ['[]', 'null', '"x"', '{"schema":1,"variants":5}', '{"schema":1,"variants":{"light":5}}',
    '{"schema":1,"variants":{"light":{"layouts":5}}}', '{"schema":1,"variants":{"light":{"layouts":[null]}}}',
    '{"schema":2,"variants":{}}']) {
    writeFileSync(join(pack, 'layouts.json'), body);
    const done = run('pack', 'measure', join(root, 'template.pptx'), '--variant', 'light', '--into', pack);
    assert.equal(done.status, 1, body);
    assert.match(done.stderr, /is not a layouts\.json this command can read/, body);
    assert.equal(readFileSync(join(pack, 'layouts.json'), 'utf8'), body);
  }
});

test('errors name the file they are about', () => {
  const root = place();
  const pack = join(root, 'example', 'pack');
  writeFileSync(join(root, 'notes.zip'), writeZip([['readme.txt', 'hello']]));
  assert.match(run('pack', 'tokens', join(root, 'notes.zip'), '--into', pack).stderr, /^notes\.zip: it holds no tokens\.json\./m);
  assert.match(run('pack', 'measure', root, '--variant', 'light', '--into', pack).stderr, /is a folder, not a PowerPoint template/);
  assert.match(run('pack', 'measure', join(root, 'template.pptx'), '--variant', 'light', '--into', pack, '--master', '9').stderr,
    /^template\.pptx: it has no master 9/m);
});
