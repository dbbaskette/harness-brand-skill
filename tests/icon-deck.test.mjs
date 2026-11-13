import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildIconDeck, iconDeck, placeOf } from '../scripts/lib/worker/icon-deck.mjs';
import { readZip } from '../scripts/lib/zip.mjs';
import { buildLibrary, libraryArchive } from '../scripts/lib/icons/library.mjs';
import { sha256 } from '../scripts/lib/pack/check.mjs';
import { makeBrands } from './fixtures/pack.mjs';
import { makeSlidesRuntime } from './fixtures/slides-runtime.mjs';

const COMMAND = fileURLToPath(new URL('../scripts/harness-brand.mjs', import.meta.url));
const SLIDES = makeSlidesRuntime();
const library = (brands) => join(brands, 'icon-libraries', 'example-icons', 'library.zip');

test('each glyph becomes a disc and a white drawing, indexed by a stable id', () => {
  const { brands } = makeBrands();
  const { deck, index } = buildIconDeck(readFileSync(library(brands)), { disc: '#005c8a' });
  assert.equal(index.sourceSha256, sha256(deck));
  assert.deepEqual(index.entries.map((each) => each.id), ['example-icons.cloud', 'example-icons.server']);
  assert.deepEqual(index.entries[1], { id: 'example-icons.server', slide: 1, label: 'Server', category: 'Data Center', native: true,
    bounds: placeOf(1).bounds, shapeIds: ['4', '5'] });
  const files = readZip(deck);
  const slide = files.get('ppt/slides/slide1.xml').toString('utf8');
  assert.match(slide, /<p:cNvPr id="2" name="example-icons\.cloud disc"\/>.*prst="ellipse".*<a:srgbClr val="005C8A"\/>/s);
  assert.match(slide, /<p:cNvPr id="3" name="example-icons\.cloud"\/>.*<a:custGeom>.*<a:moveTo><a:pt x="0" y="0"\/><\/a:moveTo><a:lnTo><a:pt x="50000" y="0"\/>.*<a:srgbClr val="FFFFFF"\/>/s);
  for (const part of ['[Content_Types].xml', 'ppt/presentation.xml', 'ppt/slideMasters/slideMaster1.xml', 'ppt/slideLayouts/slideLayout1.xml', 'ppt/theme/theme1.xml']) {
    assert.ok(files.has(part), part);
  }
  assert.deepEqual(buildIconDeck(readFileSync(library(brands)), { disc: '#005c8a' }).deck, deck, 'the same bytes every time');
});

test('icons fill slides in order, 32 to a slide, with ids unique on each', () => {
  assert.equal(placeOf(31).slide, 1);
  assert.equal(placeOf(32).slide, 2);
  assert.deepEqual(placeOf(32).shapeIds, ['2', '3']);
  assert.deepEqual(placeOf(0).bounds.slice(2), [1097100, 1097100]);
});

test('the deck is kept by library and disc colour, and made again when gone', () => {
  const { brands } = makeBrands();
  const cache = mkdtempSync(join(tmpdir(), 'hb-cache-'));
  const one = iconDeck(library(brands), { disc: '#005C8A', environment: { HARNESS_BRAND_CACHE: cache } });
  const two = iconDeck(library(brands), { disc: '#007B8C', environment: { HARNESS_BRAND_CACHE: cache } });
  assert.notEqual(one.path, two.path);
  const bytes = readFileSync(one.path);
  rmSync(one.path);
  assert.deepEqual(readFileSync(iconDeck(library(brands), { disc: '#005C8A', environment: { HARNESS_BRAND_CACHE: cache } }).path), bytes);
});

const run = (env, ...args) => spawnSync(process.execPath, [COMMAND, ...args], { encoding: 'utf8',
  env: { PATH: process.env.PATH, HOME: tmpdir(), HARNESS_SLIDES_ROOT: SLIDES, ...env } });

test('icons searches the brands\' libraries without a brand, every word matching', () => {
  const { brands } = makeBrands();
  const env = { HARNESS_BRAND_DATA: brands };
  const found = JSON.parse(run(env, 'icons', '--query', 'serv', '--limit', '8', '--json', '--no-previews').stdout);
  assert.deepEqual(found.results.map((each) => each.id), ['example-icons.server']);
  assert.equal(found.results[0].native, true);
  assert.deepEqual(Object.keys(found), ['query', 'source', 'totalMatches', 'truncated', 'results', 'guidance']);
  assert.deepEqual(JSON.parse(run(env, 'icons', '--query', 'data center', '--json').stdout).results.map((each) => each.label), ['Server']);
  assert.deepEqual(JSON.parse(run(env, 'icons', '--query', 'se', '--json').stdout).results, [], 'a short word matches only a whole word');
  assert.deepEqual(JSON.parse(run(env, 'icons', '--query', 'cloud', '--brand', 'example', '--json').stdout).totalMatches, 1);
  const bad = run(env, 'icons', '--query', 'cloud', '--limit', '50');
  assert.equal(bad.status, 2);
  assert.match(bad.stderr, /^--limit must be an integer from 1 to 20\nUsage: /);
});

test('a slides contract carries the icon deck, and check makes a cleared deck again', () => {
  const { brands } = makeBrands();
  const cache = mkdtempSync(join(tmpdir(), 'hb-cache-'));
  const env = { HARNESS_BRAND_DATA: brands, HARNESS_BRAND_CACHE: cache };
  const output = join(mkdtempSync(join(tmpdir(), 'hb-out-')), 'contract');
  assert.equal(run(env, 'contract', 'export', '--brand', 'example', '--output', output).status, 0);
  const contract = JSON.parse(readFileSync(join(output, 'brand-contract.json'), 'utf8'));
  const { library: deck } = contract.design.slides.icon;
  assert.ok(deck.path.startsWith(cache) && deck.index.startsWith(cache));
  assert.deepEqual(contract.sources.filter((each) => each.kind.startsWith('icon')).map((each) => each.path), [deck.path, deck.index]);
  rmSync(join(deck.path, '..'), { recursive: true });
  const checked = run(env, 'contract', 'check', '--file', join(output, 'brand-contract.json'));
  assert.equal(checked.status, 0, checked.stderr);
  assert.ok(existsSync(deck.path));
});

test('a kept deck that no longer matches its index is made again', () => {
  const { brands } = makeBrands();
  const where = { environment: { HARNESS_BRAND_CACHE: mkdtempSync(join(tmpdir(), 'hb-cache-')) } };
  const kept = iconDeck(library(brands), { disc: '#005C8A', ...where });
  const bytes = readFileSync(kept.path);
  writeFileSync(kept.path, Buffer.concat([bytes, Buffer.from([0])]));
  iconDeck(library(brands), { disc: '#005C8A', ...where });
  assert.deepEqual(readFileSync(kept.path), bytes);
});

test('a picture library is never drawn into a deck or offered by id', () => {
  const { brands, pack } = makeBrands();
  const pictures = buildLibrary([{ label: 'pictures', files: new Map([['Logos/spring.svg', Buffer.from('<svg viewBox="0 0 10 10"><rect width="5" height="5"/></svg>')]]) }],
    { id: 'example-pictures', name: 'Example pictures', kind: 'picture' });
  mkdirSync(join(brands, 'icon-libraries', 'example-pictures'), { recursive: true });
  writeFileSync(join(brands, 'icon-libraries', 'example-pictures', 'library.zip'), libraryArchive(pictures));
  const brand = JSON.parse(readFileSync(join(pack, 'brand.json'), 'utf8'));
  brand.icons = [{ library: 'example-pictures', default: true }, ...brand.icons.map((each) => ({ ...each, default: false }))];
  writeFileSync(join(pack, 'brand.json'), JSON.stringify(brand));
  const env = { HARNESS_BRAND_DATA: brands, HARNESS_BRAND_CACHE: mkdtempSync(join(tmpdir(), 'hb-cache-')) };
  const output = join(mkdtempSync(join(tmpdir(), 'hb-out-')), 'contract');
  assert.equal(run(env, 'contract', 'export', '--brand', 'example', '--output', output).status, 0);
  assert.match(JSON.parse(readFileSync(join(output, 'brand-contract.json'), 'utf8')).design.slides.icon.library.index, /icons\.json$/);
  assert.deepEqual(JSON.parse(run(env, 'icons', '--query', 'spring', '--json').stdout).results, []);
  assert.equal(JSON.parse(run(env, 'icons', '--query', 'cloud', '--json').stdout).totalMatches, 1);
});

test('a contract whose deck cannot be made again where it names says to export again', () => {
  const { brands } = makeBrands();
  const output = join(mkdtempSync(join(tmpdir(), 'hb-out-')), 'contract');
  const first = { HARNESS_BRAND_DATA: brands, HARNESS_BRAND_CACHE: mkdtempSync(join(tmpdir(), 'hb-cache-')) };
  assert.equal(run(first, 'contract', 'export', '--brand', 'example', '--output', output).status, 0);
  rmSync(first.HARNESS_BRAND_CACHE, { recursive: true });
  const elsewhere = { ...first, HARNESS_BRAND_CACHE: mkdtempSync(join(tmpdir(), 'hb-cache-')) };
  const checked = run(elsewhere, 'contract', 'check', '--file', join(output, 'brand-contract.json'));
  assert.equal(checked.status, 1);
  assert.match(checked.stderr, /is gone and cannot be made again here\. Export the brand contract again\./);
});
