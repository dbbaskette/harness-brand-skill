import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { checkPack } from '../scripts/lib/pack/check.mjs';
import { BRAND, makeBrands } from './fixtures/pack.mjs';

const COMMAND = fileURLToPath(new URL('../scripts/harness-brand.mjs', import.meta.url));
const BRIEF = { id: 'solution-brief', name: 'Solution brief', useWhen: 'A two-page overview of one solution.', file: 'templates/documents/solution-brief.dotx', page: 'US Letter' };
const withDocuments = (documents, files = { 'templates/documents/solution-brief.dotx': 'word' }) => {
  const brand = structuredClone(BRAND);
  brand.documents = documents;
  return makeBrands({ brand, files });
};

test('a pack may list Word document templates', () => {
  assert.deepEqual(checkPack(withDocuments([BRIEF]).pack), []);
});

test('document templates are checked one by one', () => {
  const cases = [
    [{ ...BRIEF, file: 'templates/documents/missing.dotx' }, /must name a \.dotx or \.docx file/],
    [{ ...BRIEF, file: 'assets/solution-brief.dotx' }, /must name a \.dotx or \.docx file/],
    [{ ...BRIEF, file: 'templates/documents/../../brand.json' }, /must name a \.dotx or \.docx file/],
    [{ ...BRIEF, id: 'Solution Brief' }, /needs an id of lower-case letters/],
    [{ ...BRIEF, useWhen: '' }, /a name and useWhen/],
    [{ ...BRIEF, page: 7 }, /page must say its paper size/],
  ];
  for (const [entry, expected] of cases) assert.match(checkPack(withDocuments([entry]).pack).join('\n'), expected);
  assert.match(checkPack(withDocuments([BRIEF, BRIEF]).pack).join('\n'), /repeats an id used before/);
  assert.match(checkPack(withDocuments({}).pack).join('\n'), /documents must be a list/);
});

test('documents lists a brand\'s templates with where each file is', () => {
  const made = withDocuments([BRIEF]);
  const run = (...args) => spawnSync(process.execPath, [COMMAND, 'documents', ...args], { encoding: 'utf8', env: { ...process.env, HARNESS_BRAND_DATA: made.brands } });
  const listed = JSON.parse(run('--brand', BRAND.id, '--json').stdout);
  assert.equal(listed.brand, BRAND.id);
  assert.deepEqual(listed.documents, [{ id: 'solution-brief', name: 'Solution brief', useWhen: BRIEF.useWhen, page: 'US Letter', file: BRIEF.file, path: join(made.pack, BRIEF.file) }]);
  assert.match(run('--brand', BRAND.id).stdout, /solution-brief: Solution brief \(US Letter\)/);
  assert.match(run('--brand', BRAND.id, '--id', 'white-paper').stderr, /has no document template white-paper/);
});

test('a brand without document templates says so', () => {
  const made = makeBrands();
  const done = spawnSync(process.execPath, [COMMAND, 'documents', '--brand', BRAND.id], { encoding: 'utf8', env: { ...process.env, HARNESS_BRAND_DATA: made.brands } });
  assert.match(done.stdout, /has no document templates/);
});
