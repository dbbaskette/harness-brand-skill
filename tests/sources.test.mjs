import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { readSource, sourceFiles } from '../scripts/lib/icons/sources.mjs';
import { writeZip } from '../scripts/lib/zip.mjs';

const SVG = '<svg viewBox="0 0 10 10"><rect width="5" height="5"/></svg>';

test('an icons.json with glyph paths is read as an index', () => {
  const index = { viewBox: '0 0 100 100', note: 'Colour only with brand colours.',
    icons: [{ slug: 'ai-1', name: 'AI 1', category: 'AI', bounds: [1, 2, 3, 4], d: 'M1 2 L3 4 Z' }] };
  const held = readSource(new Map([['export/assets/Icons/icons.json', Buffer.from(JSON.stringify(index))]]));
  assert.equal(held.kind, 'index');
  assert.equal(held.icons.length, 1);
  assert.equal(held.note, 'Colour only with brand colours.');
});

test('an index drawn in another box is refused', () => {
  const index = { viewBox: '0 0 24 24', icons: [{ slug: 'a', d: 'M0 0 Z' }] };
  assert.throws(() => readSource(new Map([['icons.json', Buffer.from(JSON.stringify(index))]])), /0 0 24 24/);
});

test('icon folders in an export become categories, with names from their README', () => {
  const files = new Map([
    ['t/assets/Functional Cloud/cloud-1.svg', Buffer.from(SVG)],
    ['t/assets/Functional Cloud/README.md', Buffer.from('| File | Name |\n|---|---|\n| `cloud-1.svg` | Cloud One |\n')],
    ['t/assets/Icons Data Center/Rack_2.svg', Buffer.from(SVG)],
    ['t/assets/Logos/logo.svg', Buffer.from(SVG)],
  ]);
  const held = readSource(files);
  assert.equal(held.kind, 'svg');
  assert.deepEqual(held.drawings.map(({ slug, name, category }) => ({ slug, name, category })), [
    { slug: 'cloud-1', name: 'Cloud One', category: 'Cloud' },
    { slug: 'rack-2', name: 'Rack 2', category: 'Data Center' },
  ]);
});

test('a plain folder of SVGs takes each folder name as the category', () => {
  const held = readSource(new Map([['Spring/boot.svg', Buffer.from(SVG)], ['top.svg', Buffer.from(SVG)]]));
  assert.deepEqual(held.drawings.map((d) => [d.slug, d.category]), [['boot', 'Spring'], ['top', 'General']]);
});

test('sources are read from a folder or a ZIP archive alike', () => {
  const root = mkdtempSync(join(tmpdir(), 'hb-source-'));
  mkdirSync(join(root, 'Cloud'));
  writeFileSync(join(root, 'Cloud', 'a.svg'), SVG);
  writeFileSync(join(root, '.DS_Store'), 'x');
  writeFileSync(join(root, 'set.zip'), writeZip([['Cloud/a.svg', SVG]]));
  assert.deepEqual([...sourceFiles(join(root, 'set.zip')).keys()], ['Cloud/a.svg']);
  assert.ok(sourceFiles(root).has('Cloud/a.svg'));
  assert.ok(![...sourceFiles(root).keys()].some((name) => name.includes('.DS_Store')));
});

test('macOS clutter and hidden files inside an archive are not icons', () => {
  const root = mkdtempSync(join(tmpdir(), 'hb-mac-'));
  writeFileSync(join(root, 'mac.zip'), writeZip([['Cloud/a.svg', SVG], ['__MACOSX/Cloud/._a.svg', 'x'], ['Cloud/.b.svg', SVG]]));
  const files = sourceFiles(join(root, 'mac.zip'));
  assert.deepEqual([...files.keys()], ['Cloud/a.svg']);
  assert.equal(readSource(files).drawings.length, 1);
});

test('a single SVG file is a source of one drawing', () => {
  const root = mkdtempSync(join(tmpdir(), 'hb-one-'));
  writeFileSync(join(root, 'Spring Boot.svg'), SVG);
  const held = readSource(sourceFiles(join(root, 'Spring Boot.svg')));
  assert.deepEqual(held.drawings.map((d) => [d.slug, d.name, d.category]), [['spring-boot', 'Spring Boot', 'General']]);
});

test('what is not a source is refused in a sentence', () => {
  const root = mkdtempSync(join(tmpdir(), 'hb-bad-'));
  writeFileSync(join(root, 'notes.txt'), 'hello');
  assert.throws(() => sourceFiles(join(root, 'notes.txt')), /notes\.txt is not a ZIP archive, a folder, an SVG file or a JSON index/);
  assert.throws(() => sourceFiles(join(root, 'missing')), /There is no source at/);
});

test('a bare icons.json file is a source', () => {
  const root = mkdtempSync(join(tmpdir(), 'hb-json-'));
  const index = { icons: [{ slug: 'a', name: 'A', category: 'C', bounds: [0, 0, 1, 1], paths: ['M0 0 L1 1 Z'] }] };
  writeFileSync(join(root, 'icons.json'), JSON.stringify(index));
  assert.equal(readSource(sourceFiles(join(root, 'icons.json'))).kind, 'index');
});

test('a link inside a source folder is not followed', () => {
  const root = mkdtempSync(join(tmpdir(), 'hb-link-'));
  mkdirSync(join(root, 'Cloud'));
  writeFileSync(join(root, 'Cloud', 'a.svg'), SVG);
  symlinkSync(join(root, 'Cloud'), join(root, 'Alias'));
  assert.deepEqual([...sourceFiles(root).keys()], ['Cloud/a.svg']);
});

test('a source with no icons says so', () => {
  assert.throws(() => readSource(new Map()), /holds no icons/);
  assert.throws(() => readSource(new Map([['x/icons.json', Buffer.from('{not json')]])), /x\/icons\.json, but that has no icons/);
});

test('an unusable icons.json falls back to the SVGs beside it, and an index may give paths', () => {
  const held = readSource(new Map([['icons.json', Buffer.from('{not json')], ['Cloud/a.svg', Buffer.from(SVG)]]));
  assert.equal(held.kind, 'svg');
  const index = { icons: [{ slug: 'a', name: 'A', category: 'C', bounds: [0, 0, 1, 1], paths: ['M0 0 L1 1 Z'] }] };
  assert.equal(readSource(new Map([['icons.json', Buffer.from(JSON.stringify(index))]])).kind, 'index');
});

test('accented file names keep their letters in the slug', () => {
  assert.equal(readSource(new Map([['Places/Café Crème.svg', Buffer.from(SVG)]])).drawings[0].slug, 'cafe-creme');
});

test('a PowerPoint file is not an icon source', () => {
  const root = mkdtempSync(join(tmpdir(), 'hb-pptx-'));
  writeFileSync(join(root, 'icons.pptx'), writeZip([['[Content_Types].xml', '<Types/>'], ['ppt/media/image1.svg', SVG]]));
  assert.throws(() => sourceFiles(join(root, 'icons.pptx')), /icons\.pptx is a PowerPoint or other Office file/);
});
