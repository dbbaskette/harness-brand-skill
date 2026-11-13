import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { checkPack, contrast } from '../scripts/lib/pack/check.mjs';
import { sealPack } from '../scripts/lib/pack/seal.mjs';
import { BRAND, DIRECTIONS, GUIDE, makeBrands } from './fixtures/pack.mjs';

const changed = (edit) => {
  const brand = structuredClone(BRAND);
  edit(brand, brand.variants.light, brand.variants.light.slides);
  return brand;
};
const problemsWith = (brand, files) => checkPack(makeBrands({ brand, files }).pack);
const directionsWith = (edit) => {
  const directions = structuredClone(DIRECTIONS);
  edit(directions.variants.light, directions.variants.light.directions[0]);
  return { 'directions.json': JSON.stringify(directions) };
};

test('contrast is measured as WCAG measures it', () => {
  assert.equal(contrast('#ffffff', '#000000').toFixed(1), '21.0');
  assert.equal(contrast('#000000', '#ffffff').toFixed(1), '21.0');
  assert.equal(contrast('#007b8c', '#ffffff').toFixed(2), '4.99');
});

test('Example Co passes', () => {
  assert.deepEqual(checkPack(makeBrands().pack), []);
});

test('a draft is refused, with what is left to review', () => {
  const problems = problemsWith(changed((brand) => { brand.draft = ['Check the colours.']; }));
  assert.deepEqual(problems, ['brand.json is still a draft: Check the colours.']);
});

test('brand.json is checked field by field', () => {
  const cases = [
    [(brand) => { brand.id = 'Example'; }, /needs an "id" of lower-case letters/],
    [(brand) => { brand.id = 'other'; }, /says its id is other, but its folder is example/],
    [(brand) => { brand.aliases = ['Example']; }, /"aliases": the words a request may use/],
    [(brand) => { brand.fonts.sans = 'Arial, sans-serif'; }, /fonts\.sans must be one font name/],
    [(brand) => { brand.defaultVariant = 'dark'; }, /defaultVariant is not one of its variants/],
    [(brand) => { brand.logos.onDark = 'assets/missing.svg'; }, /logos\.onDark must name a logo file/],
    [(brand) => { brand.logos.onLight = '../outside.svg'; }, /logos\.onLight must name a logo file/],
    [(brand) => { brand.language.headlineCase = 'upper'; }, /language needs headlineCase sentence or title/],
    [(brand) => { brand.icons[0].library = 'missing'; }, /Icon library 1 \(missing\) is not in brands\/icon-libraries/],
    [(brand) => { brand.icons[0].roles.push('accentPink'); }, /role accentPink is not a role of variant light/],
  ];
  for (const [edit, expected] of cases) {
    const problems = problemsWith(changed(edit));
    assert.ok(problems.some((problem) => expected.test(problem)), `${expected}: ${problems.join(' | ')}`);
  }
});

test('colour roles name tokens with plain colours, and text roles reach 4.5 to 1', () => {
  const cases = [
    [(b, variant) => { delete variant.colors.accentAqua; }, /Variant light has no accentAqua role/],
    [(b, variant) => { variant.colors.inkPrimary = 'ink'; }, /names ink, which tokens\.json has no colour called/],
    [(b, variant) => { variant.colors.inkSecondary = 'mist'; }, /inkSecondary reaches only 1\.\d\d to 1 on canvasPrimary; it needs 4\.5/],
    [(b, variant) => { variant.theme = 'dim'; }, /needs "theme": light or dark/],
  ];
  for (const [edit, expected] of cases) {
    const problems = problemsWith(changed(edit));
    assert.ok(problems.some((problem) => expected.test(problem)), `${expected}: ${problems.join(' | ')}`);
  }
});

test('large text needs only 3 to 1, smaller text 4.5', () => {
  const pale = { 'tokens.json': JSON.stringify({ schema: 1, name: 'Example Co', themes: ['light'], colors: [
    ...['white', 'mist', 'black', 'dark-gray', 'blue', 'red'].map((name) => ({ name, light: { white: '#ffffff', mist: '#eef2f6',
      black: '#000000', 'dark-gray': '#53565a', blue: '#005c8a', red: '#cc092f' }[name] })),
    { name: 'aqua', light: '#00c6c2' },   // 2.0 to 1 on white: too pale even for large text
  ] }) };
  const problems = problemsWith(BRAND, pale);
  assert.ok(problems.some((problem) => /metric text \(accentAqua\) reaches only 2\.\d\d to 1 on canvasPrimary; it needs 3\./.test(problem)),
    problems.join(' | '));
  const bold = problemsWith(changed((b, v, slides) => { slides.typography.label = { size: 14, bold: true, colorRole: 'accentAqua' }; }), pale);
  assert.ok(bold.some((problem) => /label text \(accentAqua\) .* it needs 3\./.test(problem)), '14 points bold is large text');
  const section = problemsWith(changed((b, v, slides) => { slides.typography.section = { size: 40, bold: false, colorRole: 'canvasPrimary' }; }));
  assert.deepEqual(section, [], 'a section title is not measured against the page ground');
  const small = problemsWith(changed((b, v, slides) => { slides.typography.caption.colorRole = 'accentAqua'; }), pale);
  assert.ok(small.some((problem) => /caption text \(accentAqua\) .* it needs 4\.5\./.test(problem)), small.join(' | '));
});

test('slides are checked against the measured template', () => {
  const cases = [
    [(b, v, slides) => { slides.layout = 'Two Content'; }, /"layout": the name of exactly one layout of the template \(Two Content\)/],
    [(b, v, slides) => { slides.template = 'templates/other.pptx'; }, /need "template": "templates\/light\.pptx"/],
    [(b, v, slides) => { slides.contentBox.width = 1000; }, /contentBox goes outside the canvas/],
    [(b, v, slides) => { slides.reservedBottom = 400; }, /reservedBottom must be a number at least the content box's bottom/],
    [(b, v, slides) => { delete slides.typography.quote; }, /have no quote type style/],
    [(b, v, slides) => { slides.typography.body.size = 200; }, /body style needs a size from 1 to 120 points/],
    [(b, v, slides) => { slides.chart.seriesRoles = ['accentPink']; }, /chart "seriesRoles": a list of roles the variant has/],
    [(b, v, slides) => { delete slides.table.headerTextRole; }, /table "headerFillRole" and "headerTextRole"/],
    [(b, v, slides) => { slides.icon.size = 0; }, /icon "size" in points/],
    [(b, v, slides) => { slides.image.calloutRole = 'accentPink'; }, /image calloutRole accentPink is not a role the variant has/],
    [(b, v, slides) => { slides.table.rowHeightPt = 'tall'; }, /table rowHeightPt must be a number of points/],
    [(b, v, slides) => { slides.image.fit = 'stretch'; }, /image must be an object whose fit is contain or cover/],
    [(b, v, slides) => { slides.fills.tints = 'no'; }, /fills must say tints true or false/],
  ];
  for (const [edit, expected] of cases) {
    const problems = problemsWith(changed(edit));
    assert.ok(problems.some((problem) => expected.test(problem)), `${expected}: ${problems.join(' | ')}`);
  }
});

test('a template changed since it was measured, or a layouts.json out of shape, is named', () => {
  const { pack } = makeBrands();
  writeFileSync(join(pack, 'templates', 'light.pptx'), 'not the measured template');
  assert.ok(checkPack(pack).some((problem) => /templates\/light\.pptx has changed since it was measured/.test(problem)));
  const shapeless = problemsWith(BRAND, { 'layouts.json': JSON.stringify({ schema: 1, variants: { light: { layouts: [] } } }) });
  assert.ok(shapeless.some((problem) => /variant light needs "template": "templates\/light\.pptx", a list of layouts and a list of slides/
    .test(problem)), shapeless.join(' | '));
});

test('directions are checked against the roles and the layouts', () => {
  const cases = [
    [(variant) => { variant.default = 'missing'; }, /default is not one of its directions/],
    [(variant) => { variant.closing.withWords.layout = 'Missing'; }, /closing "withWords" with the name of a layout/],
    [(v, direction) => { direction.direction.neutral = 'headingPrimary'; }, /focal and neutral roles are the same/],
    [(v, direction) => { direction.direction.neutral = 'canvasPrimary'; }, /neutral role cannot be canvasPrimary/],
    [(v, direction) => { direction.direction.neutral = 'blue'; }, /needs a focal and a neutral role the variant has/],
    [(v, direction) => { direction.direction.meanings.headingPrimary = 'Titles'; }, /gives a meaning to its own focal or neutral role/],
    [(v, direction) => { direction.direction.motif = 'x'.repeat(1001); }, /motif of at most 1000 characters/],
    [(v, direction) => { direction.layouts.cover = 'Cover'; }, /needs a cover layout of the template/],
    [(v, direction) => { direction.cues = { statusCritical: ['risk'] }; }, /gives cues for statusCritical, which has no meaning/],
    [(variant) => { variant.reservedRoles = ['accentAqua']; }, /uses the reserved role accentAqua/],
  ];
  for (const [edit, expected] of cases) {
    const problems = problemsWith(BRAND, directionsWith(edit));
    assert.ok(problems.some((problem) => expected.test(problem)), `${expected}: ${problems.join(' | ')}`);
  }
});

test('the files a pack with slides needs are named when missing', () => {
  const problems = problemsWith(BRAND, { 'directions.json': null, 'audit.json': null, 'guide.md': '# Example Co\n\n## Brand rules\n' });
  assert.ok(problems.includes('The pack has slides but no directions.json.'));
  assert.ok(problems.includes('The pack has slides but no audit.json.'));
  assert.ok(problems.includes('guide.md has no "## Voice and naming" section.'));
  assert.ok(problems.includes('guide.md has no "## Slides" section.'));
  const audit = problemsWith(BRAND, { 'audit.json': JSON.stringify({ schema: 1, maxWords: 'sixty', fonts: [3] }) });
  assert.ok(audit.includes('audit.json\'s maxWords must be a number, 0 or more.'));
  assert.ok(audit.includes('audit.json\'s fonts must be a list of words.'));
  assert.deepEqual(problemsWith(BRAND, { 'audit.json': '{ not json' }).map((problem) => problem.split(' (')[0]), ['audit.json is not JSON']);
});

test('a brand for writing only needs no template, layouts, directions or audit', () => {
  const writing = changed((brand, variant) => { delete variant.slides; });
  const problems = problemsWith(writing, { 'templates/light.pptx': null, 'layouts.json': null, 'directions.json': null,
    'audit.json': null, 'guide.md': '# Example Co\n\n## Brand rules\n\nWrite in full.\n\n## Voice and naming\n\nPlain.\n' });
  assert.deepEqual(problems, []);
});

test('a sealed pack names what changed, went or was added since, brand.json included', () => {
  const { pack } = makeBrands();
  writeFileSync(join(pack, 'brand.json'), JSON.stringify(sealPack(pack)));
  assert.deepEqual(checkPack(pack), []);
  const sealed = JSON.parse(readFileSync(join(pack, 'brand.json'), 'utf8'));
  const { name, ...others } = sealed;
  writeFileSync(join(pack, 'brand.json'), JSON.stringify({ ...others, name }));
  assert.deepEqual(checkPack(pack), [], 'moving a field is not a change');
  writeFileSync(join(pack, 'brand.json'), JSON.stringify({ ...sealed, name: 'Example Company' }, null, 1));
  writeFileSync(join(pack, 'guide.md'), `${GUIDE}\nMore.\n`);
  rmSync(join(pack, 'audit.json'));
  writeFileSync(join(pack, 'assets', 'new.svg'), '<svg/>');
  writeFileSync(join(pack, '..', 'sources', 'new.pdf'), 'pdf');
  writeFileSync(join(pack, '..', 'sources', 'tokens.json'), '{}');
  const problems = checkPack(pack);
  for (const expected of ['brand.json has changed since the pack was sealed. Seal it again.',
    'guide.md has changed since the pack was sealed. Seal it again.',
    'audit.json was sealed in brand.json but is gone. Seal it again.',
    'assets/new.svg was added since the pack was sealed. Seal it again.',
    'The source new.pdf was added since the pack was sealed. Seal it again.',
    'The source tokens.json has changed since the pack was sealed. Seal it again.']) {
    assert.ok(problems.includes(expected), `${expected}: ${problems.join(' | ')}`);
  }
  assert.ok(!checkPack(pack, { hashes: false }).some((problem) => /sealed/.test(problem)));
});

test('a seal out of shape is named, and does not stop the pack being sealed again', () => {
  const { pack } = makeBrands({ brand: { ...BRAND, files: null, sources: { '../escape': 'a'.repeat(64) } } });
  assert.ok(checkPack(pack).some((problem) => /files must give each file, a path inside the pack/.test(problem)));
  assert.deepEqual(checkPack(pack, { hashes: false }), []);
  writeFileSync(join(pack, 'brand.json'), JSON.stringify(sealPack(pack)));
  assert.deepEqual(checkPack(pack), []);
});

test('hand edits of the wrong kind are named in a sentence, never a crash', () => {
  const cases = [
    [BRAND, directionsWith((v, direction) => { direction.direction.meanings = null; }), /meanings must give each role what it stands for/],
    [BRAND, directionsWith((variant) => { variant.reservedRoles = 'statusCritical'; }), /reservedRoles must be a list of roles/],
    [BRAND, directionsWith((v, direction) => { direction.cues = ['risk']; }), /cues must give them by role/],
    [BRAND, directionsWith((variant) => { delete variant.default; variant.directions[0].id = undefined; }), /default is not one of its directions/],
    [changed((brand) => { brand.variants = 'light'; }), {}, /variants must give each variant by name/],
    [changed((brand) => { brand.defaultVariant = 'toString'; }), {}, /defaultVariant is not one of its variants/],
    [changed((b, v, slides) => { slides.typography.body.colorRole = 'toString'; }), {}, /body style needs .* a colorRole the variant has/],
    [changed((brand) => { brand.icons[0].roles = 'inkDeep'; }), {}, /roles must be a list of roles/],
    [changed((brand) => { brand.draft = []; }), {}, /still a draft: remove "draft" once it is reviewed\./],
    [BRAND, { 'tokens.json': 'null' }, /^tokens\.json needs "schema": 1 and a list of colors\.$/],
  ];
  for (const [brand, files, expected] of cases) {
    const problems = problemsWith(brand, files);
    assert.ok(problems.some((problem) => expected.test(problem)), `${expected}: ${problems.join(' | ')}`);
  }
  assert.deepEqual(problemsWith(BRAND, { 'tokens.json': 'null' }), ['tokens.json needs "schema": 1 and a list of colors.']);
});

test('what pack scaffold leaves to be written, a canvas unlike the template and a logo outside assets/ are named', () => {
  const placeholders = problemsWith(BRAND, { 'guide.md': `${GUIDE}\nReview: what Example Co always does.\n`,
    ...directionsWith((v, direction) => { direction.direction.motif = 'Review: the device that recurs.'; }) });
  assert.ok(placeholders.includes('guide.md still has text pack scaffold left to be written (a line starting "Review:").'));
  assert.ok(placeholders.includes('directions.json still has text pack scaffold left to be written (starting "Review:").'));
  const canvas = problemsWith(changed((b, v, slides) => { slides.canvas = { width: 1280, height: 720 }; }));
  assert.ok(canvas.some((problem) => /canvas is 1280 × 720 points, but the template measures 960 × 540/.test(problem)), canvas.join(' | '));
  const logo = problemsWith(changed((brand) => { brand.logos.onLight = 'guide.md'; }));
  assert.ok(logo.includes('brand.json\'s logos.onLight must name a logo file in the pack\'s assets/ folder.'));
});
