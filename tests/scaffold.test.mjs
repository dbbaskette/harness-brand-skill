import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { checkPack, sha256 } from '../scripts/lib/pack/check.mjs';
import { guessRoles, scaffoldPack } from '../scripts/lib/pack/scaffold.mjs';
import { sealPack } from '../scripts/lib/pack/seal.mjs';
import { makeBrands } from './fixtures/pack.mjs';

const read = (pack, file) => JSON.parse(readFileSync(join(pack, file), 'utf8'));

test('roles are guessed from the names a design system gives its colours', () => {
  const tokens = { colors: [
    { name: 'white', light: '#ffffff' }, { name: 'surface', light: '#ffffff', dark: '#1b1d36' },
    { name: 'ink', light: '#000000', dark: '#ffffff' }, { name: 'ink-title', light: '#005c8a', dark: '#ffffff' },
    { name: 'aqua', light: '#007b8c' }, { name: 'panel', light: '#f4f8fa' }, { name: 'on-accent', light: '#ffffff', dark: '#000000' },
  ] };
  assert.deepEqual(guessRoles(tokens, 'light'), { colors: { canvasPrimary: 'surface', canvasSecondary: 'panel', inkPrimary: 'ink',
    inkDeep: 'ink', headingPrimary: 'ink-title', accentAqua: 'aqua', onAccent: 'on-accent' }, unguessed: [] });
  const bare = guessRoles({ colors: [{ name: 'white', light: '#ffffff' }] }, 'light');
  assert.deepEqual(bare.colors, { canvasPrimary: 'white', onAccent: 'white' });
  assert.deepEqual(bare.unguessed, ['canvasSecondary', 'inkPrimary', 'inkDeep', 'headingPrimary', 'accentAqua']);
});

test('a draft takes its slides from the measured template, and is marked as a draft', () => {
  const { pack } = makeBrands();
  const made = scaffoldPack({ id: 'example', name: 'Example Co', tokens: read(pack, 'tokens.json'),
    layouts: read(pack, 'layouts.json'), icons: ['example-icons'] });
  const slides = made.brand.variants.light.slides;
  assert.equal(slides.layout, 'Title Only');
  assert.deepEqual(slides.canvas, { width: 960, height: 540 });
  assert.deepEqual(slides.titleBox, { x: 48, y: 36, width: 864, height: 60 });
  // Title Only has no body, and no layout with a title has one: the box is the space below the title.
  assert.deepEqual(slides.contentBox, { x: 48, y: 108, width: 864, height: 380 });
  assert.equal(slides.reservedBottom, 500);   // the slide number's top
  assert.deepEqual(slides.typography.title, { size: 28, bold: true, colorRole: 'inkPrimary' });
  assert.equal(made.brand.variants.light.colors.headingPrimary, 'blue');
  assert.equal(made.directions.variants.light.directions[0].layouts.cover, 'Title Slide');
  assert.deepEqual(made.brand.icons, [{ library: 'example-icons', default: true, roles: ['headingPrimary', 'accentAqua', 'inkDeep'] }]);
  assert.ok(made.brand.draft.length > 0);
  assert.match(made.guide, /^## Slides$/m);
});

test('pack check refuses a draft until it is reviewed, then passes it', () => {
  const { pack } = makeBrands();
  const made = scaffoldPack({ id: 'example', name: 'Example Co', tokens: read(pack, 'tokens.json'), layouts: read(pack, 'layouts.json'),
    icons: ['example-icons'] });
  writeFileSync(join(pack, 'brand.json'), JSON.stringify(made.brand));
  writeFileSync(join(pack, 'directions.json'), JSON.stringify(made.directions));
  assert.match(checkPack(pack)[0], /^brand\.json is still a draft: Check every colour role/);
  const { draft, ...reviewed } = made.brand;
  assert.ok(draft);
  writeFileSync(join(pack, 'brand.json'), JSON.stringify(reviewed));
  writeFileSync(join(pack, 'guide.md'), made.guide);
  assert.deepEqual(checkPack(pack), ['guide.md still has text pack scaffold left to be written (a line starting "Review:").',
    'directions.json still has text pack scaffold left to be written (starting "Review:").']);
  const written = structuredClone(made.directions);
  written.house = ['Use one approved icon for each concrete idea.'];
  written.variants.light.directions[0].direction.motif = 'A strip on each card says what it is about.';
  writeFileSync(join(pack, 'directions.json'), JSON.stringify(written));
  writeFileSync(join(pack, 'guide.md'), made.guide.replace(/^Review: /gm, ''));
  assert.deepEqual(checkPack(pack), []);
});

test('a brand without a template gets a draft for writing only', () => {
  const made = scaffoldPack({ id: 'notes', name: 'Notes', layouts: null,
    tokens: { themes: ['light', 'dark'], colors: [], type: { families: { sans: '"Metropolis", Arial, sans-serif' } } } });
  assert.equal(made.brand.fonts.sans, 'Metropolis');
  assert.deepEqual(Object.keys(made.brand.variants), ['light', 'dark']);
  assert.equal(made.brand.variants.dark.theme, 'dark');
  assert.equal(made.brand.variants.light.slides, undefined);
  assert.equal(made.directions, undefined);
  assert.equal(made.audit, undefined);
  assert.doesNotMatch(made.guide, /## Slides/);
});

test('sealing records every pack file and source, and refuses a pack that does not pass', () => {
  const { pack } = makeBrands();
  const sealed = sealPack(pack);
  assert.equal(sealed.files['guide.md'], sha256(readFileSync(join(pack, 'guide.md'))));
  assert.equal(sealed.sources['template.pptx'], sha256(readFileSync(join(pack, '..', 'sources', 'template.pptx'))));
  assert.ok(!('brand.json' in sealed.files));
  assert.match(sealed.brandSha256, /^[0-9a-f]{64}$/);
  writeFileSync(join(pack, 'brand.json'), JSON.stringify(sealed));
  assert.deepEqual(checkPack(pack), []);
  writeFileSync(join(pack, 'guide.md'), '# Example Co\n');
  assert.throws(() => sealPack(pack), /does not pass, so it was not sealed:\n {2}guide\.md has no "## Brand rules" section\./);
});
