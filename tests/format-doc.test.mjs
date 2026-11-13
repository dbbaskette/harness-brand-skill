import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { checkLibrary } from '../scripts/lib/icons/library.mjs';
import { USAGE } from '../scripts/pack.mjs';
import { writeZip } from '../scripts/lib/zip.mjs';

const doc = readFileSync(new URL('../docs/icon-library-format.md', import.meta.url), 'utf8');
const blocks = [...doc.matchAll(/```json\n([\s\S]*?)```/g)].map((m) => JSON.parse(m[1]));
const libraryOf = (kind) => blocks.find((block) => block.kind === kind);
const indexOf = (field) => blocks.find((block) => Array.isArray(block.icons) && block.icons[0]?.[field]);

test('the document\'s glyph example makes a library that passes the check', () => {
  const library = libraryOf('glyph');
  const index = indexOf('paths');
  assert.ok(library && index, 'the document shows a glyph library.json and its icons.json');
  assert.deepEqual(checkLibrary(writeZip([['library.json', JSON.stringify(library)],
    ['icons.json', JSON.stringify(index)]]), { id: library.id }), []);
});

test('the document\'s picture example passes, and fails with a script in its drawing', () => {
  const library = libraryOf('picture');
  const index = indexOf('file');
  assert.ok(library && index, 'the document shows a picture library.json and its icons.json');
  const archive = (drawing) => writeZip([['library.json', JSON.stringify(library)],
    ['icons.json', JSON.stringify(index)], [index.icons[0].file, drawing]]);
  assert.deepEqual(checkLibrary(archive('<svg viewBox="0 0 10 10"><rect width="9" height="9"/></svg>'), { id: library.id }), []);
  assert.notDeepEqual(checkLibrary(archive('<svg><script>alert(1)</script></svg>'), { id: library.id }), []);
});

test('the document describes every field in a table', () => {
  for (const field of ['schema', 'id', 'name', 'version', 'kind', 'source', 'usage', 'slug',
    'category', 'keywords', 'bounds', 'paths', 'file']) {
    assert.ok(doc.includes(`| \`${field}\` |`), `the document has no table row for ${field}`);
  }
});

test('the document names every option of pack icons, and the numbers the check uses', () => {
  const iconsUsage = USAGE.slice(USAGE.indexOf('pack icons'), USAGE.indexOf('pack check'));
  for (const option of new Set(iconsUsage.match(/--[a-z-]+/g))) {
    assert.match(doc, new RegExp(`${option}(?![a-z-])`), `the document does not mention ${option}`);
  }
  for (const phrase of ['from -1 to 101', '95%']) assert.ok(doc.includes(phrase), `the document does not say ${phrase}`);
});
