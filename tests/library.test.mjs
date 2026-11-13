import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  alignCategory, buildLibrary, checkLibrary, libraryArchive,
} from '../scripts/lib/icons/library.mjs';
import { readZip, writeZip } from '../scripts/lib/zip.mjs';

const SQUARE = '<svg viewBox="0 0 10 10"><rect width="5" height="5"/></svg>';
const LINES = '<svg viewBox="0 0 10 10"><path d="M0 0 L9 9" fill="none" stroke="#000"/></svg>';
const index = (icons, note = 'Brand colours only.') => new Map([['assets/Icons/icons.json',
  Buffer.from(JSON.stringify({ viewBox: '0 0 100 100', note, icons }))]]);
const glyph = (slug, category = 'Cloud') => ({ slug, name: slug, category, bounds: [0, 0, 50, 50], d: 'M0 0 L50 0 L50 50 Z' });
const options = { id: 'test-icons', name: 'Test icons' };

test('categories line up with the first source when they plainly mean the same', () => {
  const known = ['Apps & Software', 'Business Tools / Objects', 'Business Tools / Tools', 'Business Tools / Process', 'Data Center'];
  assert.equal(alignCategory('Apps', known), 'Apps & Software');
  assert.equal(alignCategory('Apps and Software', known), 'Apps & Software');
  assert.equal(alignCategory('Business Objects', known), 'Business Tools / Objects');
  assert.equal(alignCategory('Tools', known), 'Business Tools / Tools');
  assert.equal(alignCategory('Business Process', known), 'Business Tools / Process');
  assert.equal(alignCategory('data center', known), 'Data Center');
  assert.equal(alignCategory('Spring', known), 'Spring');
});

test('the first source wins where slugs meet, and later sources add what is new', () => {
  const built = buildLibrary([
    { label: 'one.zip', files: index([glyph('cloud-1'), glyph('ai-1', 'AI')]) },
    { label: 'two.zip', files: new Map([
      ['x/assets/Functional Cloud/cloud-1.svg', Buffer.from(SQUARE)],
      ['x/assets/Functional Cloud/cloud-9.svg', Buffer.from(SQUARE)],
      ['x/assets/Functional Cloud/drawn.svg', Buffer.from(LINES)],
    ]) },
  ], options);
  assert.deepEqual(built.icons.map((icon) => icon.slug), ['cloud-1', 'ai-1', 'cloud-9']);
  assert.deepEqual(built.counts, [{ source: 'one.zip', added: 2, already: 0 },
    { source: 'two.zip', added: 1, already: 1 }]);
  assert.deepEqual(built.skipped, [{ source: 'two.zip', file: 'x/assets/Functional Cloud/drawn.svg',
    reason: 'it is drawn with lines, not filled shapes' }]);
  assert.equal(built.library.usage, 'Brand colours only.');
  assert.equal(built.library.kind, 'glyph');
});

test('fill can differ by source', () => {
  const files = new Map([['C/a.svg', Buffer.from('<svg viewBox="0 0 10 10"><rect width="10" height="10"/></svg>')]]);
  const built = buildLibrary([{ label: 'tanzu.zip', files }], { ...options, fills: { 'tanzu.zip': 0.5 } });
  assert.deepEqual(built.icons[0].bounds, [25, 25, 75, 75]);
});

test('a repeated file name within one source is numbered, not lost', () => {
  const built = buildLibrary([{ label: 's', files: new Map([
    ['Icons A/x.svg', Buffer.from(SQUARE)], ['Icons B/x.svg', Buffer.from(SQUARE)]]) }], options);
  assert.deepEqual(built.icons.map((icon) => icon.slug), ['x', 'x-2']);
});

test('a slug repeated within one index keeps both drawings, renaming the second from its name', () => {
  const built = buildLibrary([{ label: 'one', files: index([
    { ...glyph('apps-2'), name: 'Apps 2' },
    { ...glyph('apps-2'), name: 'Apps', d: 'M0 0 L10 0 L10 10 Z' },
    { ...glyph('apps-2'), name: 'Apps 2' },
  ]) }], options);
  assert.deepEqual(built.icons.map((icon) => [icon.slug, icon.name]), [['apps-2', 'Apps 2'], ['apps', 'Apps']]);
  assert.deepEqual(built.skipped, []);
});

test('a source with no icons is named in the refusal', () => {
  assert.throws(() => buildLibrary([{ label: 'empty.zip', files: new Map() }], options), /empty\.zip: It holds no icons/);
});

test('a picture library keeps each drawing as it is', () => {
  const built = buildLibrary([{ label: 's', files: new Map([['Logos/spring.svg', Buffer.from(SQUARE)]]) }],
    { ...options, kind: 'picture' });
  assert.deepEqual(built.icons, [{ slug: 'spring', name: 'Spring', category: 'Logos', file: 'svg/logos/spring.svg' }]);
  assert.equal(built.svgs.get('svg/logos/spring.svg'), SQUARE);
});

test('an archive made from a build passes the check', () => {
  const built = buildLibrary([{ label: 'one', files: index([glyph('cloud-1')]) }], options);
  const archive = libraryArchive(built);
  assert.deepEqual(checkLibrary(archive, { id: 'test-icons' }), []);
  const files = readZip(archive);
  assert.equal(JSON.parse(files.get('library.json').toString()).id, 'test-icons');
  // An index's single "d" is kept as a list of one path.
  assert.deepEqual(JSON.parse(files.get('icons.json').toString()).icons[0].paths, ['M0 0 L50 0 L50 50 Z']);
});

test('the check names each problem', () => {
  const bad = writeZip([
    ['library.json', JSON.stringify({ schema: 1, id: 'Bad Id', name: '', version: 1, kind: 'glyph' })],
    ['icons.json', JSON.stringify({ schema: 1, icons: [
      { slug: 'a', name: 'A', category: 'C', bounds: [0, 0, 1], paths: ['M0 0 Z'] },
      { slug: 'a', name: 'A', category: 'C', bounds: [0, 0, 1, 1], paths: ['nonsense'] },
    ] })],
  ]);
  const problems = checkLibrary(bad, { id: 'bad-id' });
  assert.ok(problems.some((p) => p.includes('"id"')), problems.join('\n'));
  assert.ok(problems.some((p) => p.includes('"name"')));
  assert.ok(problems.some((p) => p.includes('"version"')));
  assert.ok(problems.some((p) => p.includes('Icon 1 (a)') && p.includes('bounds')));
  assert.ok(problems.some((p) => p.includes('Icon 2 (a)') && p.includes('repeats')));
  assert.ok(problems.some((p) => p.includes('Icon 2 (a)') && p.includes('"paths"')));
  assert.deepEqual(checkLibrary(Buffer.from('nope')), ['library.zip cannot be read: It is not a ZIP archive.']);
});

test('a picture whose drawing has a script is refused', () => {
  const archive = writeZip([
    ['library.json', JSON.stringify({ schema: 1, id: 'p', name: 'P', version: '1', kind: 'picture' })],
    ['icons.json', JSON.stringify({ schema: 1, icons: [{ slug: 'x', name: 'X', category: 'C', file: 'svg/c/x.svg' }] })],
    ['svg/c/x.svg', '<svg><script>alert(1)</script></svg>'],
  ]);
  assert.deepEqual(checkLibrary(archive), ['Icon 1 (x) has a drawing with a script in it.']);
});

test('an index that dropped ligatures from slugs meets the same icon spelled out', () => {
  const built = buildLibrary([
    { label: 'one', files: index([{ ...glyph('certi-ed'), name: 'certiﬁed' }]) },
    { label: 'two', files: new Map([['Icons Cloud/certified.svg', Buffer.from(SQUARE)]]) },
  ], options);
  assert.deepEqual(built.icons.map((icon) => [icon.slug, icon.name]), [['certified', 'certified']]);
  assert.deepEqual(built.counts[1], { source: 'two', added: 0, already: 1 });
});

test('a glyph library holds no drawings beside its shapes', () => {
  const built = buildLibrary([{ label: 's', files: new Map([['Cloud/a.svg', Buffer.from(SQUARE)]]) }], options);
  assert.deepEqual([...readZip(libraryArchive(built)).keys()], ['library.json', 'icons.json']);
});

test('blank names and categories get sensible ones, so a build passes its own check', () => {
  const built = buildLibrary([{ label: 'one', files: index([
    { ...glyph('cloud-9'), name: '', category: '', keywords: ['sky', 3, ''] }]) }], options);
  assert.equal(built.icons[0].name, 'Cloud 9');
  assert.equal(built.icons[0].category, 'General');
  assert.deepEqual(built.icons[0].keywords, ['sky']);
  assert.deepEqual(checkLibrary(libraryArchive(built)), []);
});

test('a renamed repeat never takes a slug a later icon owns', () => {
  const built = buildLibrary([{ label: 'one', files: index([
    { ...glyph('apps-2'), name: 'Apps 2' },
    { ...glyph('apps-2'), name: 'Apps', d: 'M0 0 L10 0 L10 10 Z' },
    { ...glyph('apps'), name: 'Apps', d: 'M0 0 L20 0 L20 20 Z' },
  ]) }], options);
  assert.deepEqual(built.icons.map((icon) => icon.slug), ['apps-2', 'apps-3', 'apps']);
});

test('the check refuses JSON that is not an object, bounds that are not a box, and unsafe pictures', () => {
  assert.ok(checkLibrary(writeZip([['library.json', 'null'], ['icons.json', 'null']]))
    .includes('library.json must be a JSON object.'));
  const flat = writeZip([
    ['library.json', JSON.stringify({ schema: 1, id: 'g', name: 'G', version: '1', kind: 'glyph' })],
    ['icons.json', JSON.stringify({ schema: 1, icons: [
      { slug: 'a', name: 'A', category: 'C', bounds: [60, 60, 10, 10], paths: ['M0 0 L1 1 Z'] }] })],
  ]);
  assert.match(checkLibrary(flat)[0], /bounds/);
  const picture = (file, drawing) => writeZip([
    ['library.json', JSON.stringify({ schema: 1, id: 'p', name: 'P', version: '1', kind: 'picture' })],
    ['icons.json', JSON.stringify({ schema: 1, icons: [{ slug: 'x', name: 'X', category: 'C', file }] })],
    [file, drawing],
  ]);
  assert.match(checkLibrary(picture('../x.svg', '<svg/>'))[0], /svg\/<category>\/<slug>\.svg/);
  assert.match(checkLibrary(picture('svg/c/x.svg', '<svg onload="alert(1)"/>'))[0], /script/);
});

test('a picture with a script is left out, and the rest of the library is kept', () => {
  const built = buildLibrary([{ label: 's', files: new Map([
    ['Logos/good.svg', Buffer.from(SQUARE)], ['Logos/bad.svg', Buffer.from('<svg onload="x()"/>')]]) }],
    { ...options, kind: 'picture' });
  assert.deepEqual(built.icons.map((icon) => icon.slug), ['good']);
  assert.deepEqual(built.skipped.map((each) => each.reason), ['its drawing has a script in it']);
});

test('a renamed SVG never takes a slug a later file owns', () => {
  const built = buildLibrary([{ label: 's', files: new Map([
    ['Icons A/x.svg', Buffer.from(SQUARE)], ['Icons B/x.svg', Buffer.from(SQUARE)], ['Icons C/x-2.svg', Buffer.from(SQUARE)]]) }], options);
  assert.deepEqual(built.icons.map((icon) => icon.slug), ['x', 'x-3', 'x-2']);
});
