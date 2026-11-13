import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { writeZip } from '../scripts/lib/zip.mjs';
import { makeBrands } from './fixtures/pack.mjs';
import { makeSlidesRuntime } from './fixtures/slides-runtime.mjs';

const COMMAND = fileURLToPath(new URL('../scripts/harness-brand.mjs', import.meta.url));
const SLIDES = makeSlidesRuntime();
const run = (env, ...args) => spawnSync(process.execPath, [COMMAND, ...args], { encoding: 'utf8',
  env: { PATH: process.env.PATH, HOME: tmpdir(), HARNESS_SLIDES_ROOT: SLIDES, HARNESS_BRAND_CACHE: mkdtempSync(join(tmpdir(), 'hb-cache-')), ...env } });

const NS = 'xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships" xmlns:p="http://schemas.openxmlformats.org/presentationml/2006/main"';
const REL = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships';
const PKG = 'http://schemas.openxmlformats.org/package/2006/relationships';
const shape = (id, name, text, { size = 2400, font = 'Arial', x = 0 } = {}) => `<p:sp><p:nvSpPr><p:cNvPr id="${id}" name="${name}"/><p:cNvSpPr/><p:nvPr/></p:nvSpPr>`
  + `<p:spPr><a:xfrm><a:off x="${x}" y="0"/><a:ext cx="914400" cy="914400"/></a:xfrm></p:spPr><p:txBody><a:bodyPr/><a:p><a:r><a:rPr sz="${size}"><a:latin typeface="${font}"/></a:rPr><a:t>${text}</a:t></a:r></a:p></p:txBody></p:sp>`;

/** A deck of slides, each on a layout of the given name with the given shapes. */
function deck(slides) {
  const files = [['ppt/presentation.xml', `<p:presentation ${NS}><p:sldIdLst>${slides.map((_, i) => `<p:sldId id="${256 + i}" r:id="rId${i + 1}"/>`).join('')}</p:sldIdLst><p:sldSz cx="12192000" cy="6858000"/></p:presentation>`],
    ['ppt/_rels/presentation.xml.rels', `<Relationships xmlns="${PKG}">${slides.map((_, i) => `<Relationship Id="rId${i + 1}" Type="${REL}/slide" Target="slides/slide${i + 1}.xml"/>`).join('')}</Relationships>`]];
  slides.forEach(({ layout, shapes }, i) => {
    files.push([`ppt/slides/slide${i + 1}.xml`, `<p:sld ${NS}><p:cSld><p:spTree>${shapes.join('')}</p:spTree></p:cSld></p:sld>`]);
    files.push([`ppt/slides/_rels/slide${i + 1}.xml.rels`, `<Relationships xmlns="${PKG}"><Relationship Id="rId1" Type="${REL}/slideLayout" Target="../slideLayouts/layout${i + 1}.xml"/></Relationships>`]);
    files.push([`ppt/slideLayouts/layout${i + 1}.xml`, `<p:sldLayout ${NS}><p:cSld name="${layout}"><p:spTree/></p:cSld></p:sldLayout>`]);
  });
  const file = join(mkdtempSync(join(tmpdir(), 'hb-deck-')), 'deck.pptx');
  writeFileSync(file, writeZip(files));
  return file;
}

test('the audit ties each finding to its slide, and template text blocks the deck', () => {
  const { brands } = makeBrands();
  const many = Array.from({ length: 70 }, (_, i) => `word${i}`).join(' ');
  const file = deck([
    { layout: 'Title Only ', shapes: [shape(2, 'slide_one_title', 'A clear title'), shape(3, 'slide_one_source', 'Source: docs', { size: 1400 })] },
    { layout: 'Title Only ', shapes: [shape(2, 'body', 'Click to add text'), shape(3, 'small', 'Tiny words', { size: 1000, font: 'Comic Sans MS' })] },
    { layout: 'Somebody Else', shapes: [shape(2, 'body', many, { x: 12000000 })] },
  ]);
  const done = run({ HARNESS_BRAND_DATA: brands }, 'presentation', '--brand', 'example', '--file', file, '--json');
  assert.equal(done.status, 2, done.stderr);
  const report = JSON.parse(done.stdout);
  assert.equal(report.status, 'BLOCKED');
  assert.deepEqual(report.blockers.map((each) => [each.ruleId, each.slide]), [['UNRESOLVED_PLACEHOLDER', 2]]);
  assert.deepEqual(report.warnings.map((each) => [each.ruleId, each.slide]).sort(),
    [['BRAND_LAYOUT_UNKNOWN', 3], ['FONT_NOT_IN_BRAND', 2], ['HIGH_TEXT_DENSITY', 3], ['OUT_OF_BOUNDS', 3], ['SMALL_TEXT', 2]].sort());
  assert.deepEqual(report.slides.map((each) => each.words), [5, 6, 70]);
  assert.equal(report.slides[0].minFontPt, 14, 'a source line at the caption size is measured but not small text');
  const clean = deck([{ layout: 'Title Only ', shapes: [shape(2, 'title', 'Fine')] }]);
  const passed = run({ HARNESS_BRAND_DATA: brands }, 'presentation', '--brand', 'example', '--file', clean, '--json');
  assert.equal(passed.status, 0);
  assert.equal(JSON.parse(passed.stdout).status, 'PASS');
  const refused = run({ HARNESS_BRAND_DATA: brands }, 'presentation', '--brand', 'example', '--file', 'deck.key');
  assert.equal(refused.status, 2);
  assert.match(refused.stderr, /^--file requires a \.pptx path/);
});

test('guidance answers the probe, starts with the brand block and refuses an unknown brand first', () => {
  const { brands } = makeBrands();
  const env = { HARNESS_BRAND_DATA: brands };
  const probe = run(env, 'guidance');
  assert.match(probe.stdout + probe.stderr, /\bstart\b/);
  assert.match(probe.stdout + probe.stderr, /\bresume\b/);
  assert.match(probe.stdout, /--brand/);
  const project = mkdtempSync(join(tmpdir(), 'hb-project-'));
  const done = run(env, 'guidance', 'start', '--skill', 'slides', '--project', project, '--brand', 'example');
  assert.equal(done.status, 0, done.stderr);
  const started = JSON.parse(done.stdout);
  assert.equal(started.task, 'task-1');
  assert.ok(started.brand.review.endsWith('references/slide-review.md'));
  assert.equal(started.brand.checkpoints.length, 4);
  assert.match(started.brand.worker, /^# Example Co slides: worker guidance/);
  assert.equal(started.brand.deckDirection.default, 'example-clear');
  assert.match(run(env, 'guidance', 'resume', '--skill', 'slides', '--project', project, '--task', 'task-2').stderr, /Saved guidance changed/);
  assert.match(run(env, 'guidance', 'start', '--skill', 'slides', '--project', project, '--brand', 'nosuch').stderr, /Unknown brand: nosuch/);
});

test('look answers the probe, and choose records the person\'s words once, refusing a changed outline in that word alone', () => {
  const { brands } = makeBrands();
  const env = { HARNESS_BRAND_DATA: brands };
  const probe = run(env, 'look');
  assert.match(probe.stderr, /\bsamples\b/);
  assert.match(probe.stderr, /\bchoose\b/);
  const dir = mkdtempSync(join(tmpdir(), 'hb-looks-'));
  const outline = join(dir, 'outline.json');
  writeFileSync(outline, JSON.stringify({ version: 1, title: 'Deck', slides: [{ id: 'cover_one', kind: 'cover', title: 'Deck' }] }));
  const samples = join(dir, 'samples');
  mkdirSync(samples);
  const output = join(dir, 'contract');
  assert.equal(run(env, 'contract', 'export', '--brand', 'example', '--output', output).status, 0);
  writeFileSync(join(samples, 'brand-contract.json'), readFileSync(join(output, 'brand-contract.json')));
  const direction = JSON.parse(readFileSync(join(output, 'deck-direction.json'), 'utf8')).directions[0];
  writeFileSync(join(samples, 'looks.json'), JSON.stringify({ schema: 1, status: 'awaiting-choice', identity: { id: 'example', name: 'Example Co', variant: 'light' },
    outlineSha256: createHash('sha256').update(readFileSync(outline)).digest('hex'), slide: 'cover_one', default: direction.id, house: ['One rule.'],
    samples: [{ id: direction.id, name: direction.name, useWhen: direction.useWhen, direction: direction.direction, layouts: direction.layouts,
      pptx: join(samples, direction.id, 'look.pptx'), build: join(samples, direction.id, 'build-1'), image: null }] }));
  const write = join(dir, 'chosen.json');
  const args = ['look', 'choose', '--samples', samples, '--choice', direction.id, '--outline', outline, '--write', write];
  const refusals = [];
  const refused = (done, pattern) => { assert.equal(done.status, 1); assert.match(done.stderr, pattern); refusals.push(done.stderr); };
  refused(run(env, ...args), /a choice needs their words/);
  refused(run(env, ...args, '--words', 'That one'), /^These samples were not rendered; choose with --unrendered\./);
  refused(run(env, 'look', 'choose', '--samples', samples, '--choice', 'nosuch', '--words', 'x'), /nosuch is not one of the samples/);
  const original = readFileSync(outline);
  writeFileSync(outline, `${original} `);
  const changed = run(env, ...args, '--words', 'That one', '--unrendered');
  assert.match(changed.stderr, /^The outline has changed since the samples were made; take new samples first/);
  writeFileSync(outline, original);
  const chosen = run(env, ...args, '--words', 'That one', '--unrendered');
  assert.equal(chosen.status, 0, chosen.stderr);
  assert.equal(JSON.parse(chosen.stdout).shown, 'unrendered');
  const plan = JSON.parse(readFileSync(write, 'utf8'));
  assert.deepEqual(plan.direction, direction.direction);
  assert.match(plan.approval.at(-1), /^Look chosen: Clear \(example-clear\), from samples that were not rendered .*In their words: "That one"$/);
  refused(run(env, 'look', 'choose', '--samples', samples, '--choice', direction.id, '--words', 'This', '--unrendered'), /already chosen/);
  for (const each of refusals) assert.doesNotMatch(each, /changed/i, 'only the stale-outline refusal says changed');
});

test('table cells are audited, footers are not, and Harness Slides caption lines may be caption size', () => {
  const { brands } = makeBrands();
  const cell = (text) => `<a:tc><a:txBody><a:bodyPr/><a:p><a:r><a:rPr sz="1000"/><a:t>${text}</a:t></a:r></a:p></a:txBody></a:tc>`;
  const table = `<p:graphicFrame><p:nvGraphicFramePr><p:cNvPr id="4" name="table_one"/><p:cNvGraphicFramePr/><p:nvPr/></p:nvGraphicFramePr>`
    + '<p:xfrm><a:off x="0" y="0"/><a:ext cx="914400" cy="914400"/></p:xfrm><a:graphic><a:graphicData uri="http://schemas.openxmlformats.org/drawingml/2006/table">'
    + `<a:tbl><a:tr h="370840">${cell('Click to add text')}${cell('More words here')}</a:tr></a:tbl></a:graphicData></a:graphic></p:graphicFrame>`;
  const footer = '<p:sp><p:nvSpPr><p:cNvPr id="5" name="Footer"/><p:cNvSpPr/><p:nvPr><p:ph type="ftr"/></p:nvPr></p:nvSpPr><p:spPr/>'
    + '<p:txBody><a:bodyPr/><a:p><a:r><a:rPr sz="800"/><a:t>Confidential</a:t></a:r></a:p></p:txBody></p:sp>';
  const file = deck([{ layout: 'Title Only ', shapes: [table, footer, shape(6, 'edge_one_label', 'Calls', { size: 1400 })] }]);
  const report = JSON.parse(run({ HARNESS_BRAND_DATA: brands }, 'presentation', '--brand', 'example', '--file', file, '--json').stdout);
  assert.deepEqual(report.blockers.map((each) => [each.ruleId, each.shapeId]), [['UNRESOLVED_PLACEHOLDER', '4']]);
  assert.deepEqual(report.warnings.map((each) => [each.ruleId, each.shapeId]), [['SMALL_TEXT', '4']]);
  assert.equal(report.slides[0].words, 8, 'the table\'s words count, the footer\'s do not');
  assert.equal(run({ HARNESS_BRAND_DATA: brands }, 'presentation', '--brand', 'example', '--file', file, '--exceptions', 'x.json').status, 2);
});

test('a look is shown on the first slide that can be drawn: the candidates, best first', async () => {
  const { lookCandidates, lookSlide } = await import('../scripts/lib/worker/looks.mjs');
  const slide = (id, more = {}) => ({ id, kind: 'content', title: id, ...more });
  const two = [{ label: 'One' }, { label: 'Two' }];
  const outline = { slides: [{ id: 'cover', kind: 'cover', title: 'Deck' }, slide('plain'),
    slide('drawn', { relation: 'parallel', points: two }), slide('focal_one', { relation: 'order', points: two, focal: 'One' }),
    slide('unrelated', { relation: 'none', points: two }), slide('focal_two', { relation: 'parallel', points: two, focal: 'Two' })] };
  // The first is the slide a look was always shown on; the rest are tried when it does not fit.
  assert.deepEqual(lookCandidates(outline).map((each) => each.id), ['focal_one', 'focal_two', 'drawn', 'plain', 'unrelated']);
  assert.equal(lookSlide(outline).id, 'focal_one');
  assert.equal(lookSlide(outline, 'plain').id, 'plain');
  assert.throws(() => lookSlide(outline, 'cover'), /No content slide cover/);
  assert.deepEqual(lookCandidates({ slides: [] }), []);
  assert.throws(() => lookSlide({ slides: [] }), /no content slide/);
});
