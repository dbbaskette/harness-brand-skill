import { test } from 'node:test';
import assert from 'node:assert/strict';
import { lostLayouts, measureTemplate, mergeLayouts } from '../scripts/lib/pack/measure.mjs';
import { writeZip } from '../scripts/lib/zip.mjs';
import { makeTemplate } from './fixtures/template.mjs';

const measured = measureTemplate(makeTemplate(), { variant: 'light' });
const byName = (name) => measured.layouts.find((layout) => layout.name === name);

test('the master the visible slides use is measured, and the others are listed', () => {
  assert.equal(measured.master, 'ppt/slideMasters/slideMaster2.xml');
  assert.equal(measured.chosenBy, 'slides');
  assert.deepEqual(measured.masters, [
    { number: 1, part: 'ppt/slideMasters/slideMaster1.xml', layouts: 1, slides: 0 },
    { number: 2, part: 'ppt/slideMasters/slideMaster2.xml', layouts: 3, slides: 2 },
  ]);
  assert.deepEqual(measured.layouts.map((layout) => layout.id), ['light-layout-001', 'light-layout-002', 'light-layout-003']);
  assert.deepEqual(measured.canvas, { width: 960, height: 540 });
  assert.equal(measured.template, 'templates/light.pptx');
  assert.match(measured.sha256, /^[0-9a-f]{64}$/);
});

test('the theme gives its colours, a system colour by its last value, and its fonts', () => {
  assert.equal(measured.theme.part, 'ppt/theme/theme2.xml');
  assert.deepEqual(measured.theme.colors, { dk1: '#000000', lt1: '#ffffff', accent1: '#1f4e8c' });
  assert.deepEqual(measured.theme.fonts, { major: 'Arial', minor: 'Arial' });
});

test('a placeholder with no frame takes its master placeholder\'s, and its text style is resolved', () => {
  assert.deepEqual(byName('Title Slide').placeholders, [
    { id: '10', type: 'ctrTitle', bounds: [100, 200, 700, 100], size: 40, bold: true, font: 'Arial',
      color: { scheme: 'accent1', hex: '#1f4e8c' } },
    { id: '11', type: 'subTitle', idx: '1', bounds: [48, 120, 864, 360], inherited: true, size: 20,
      color: { hex: '#333333' } },
  ]);
  assert.deepEqual(byName('Title Only').placeholders, [
    { id: '20', type: 'title', bounds: [48, 36, 864, 60], inherited: true, size: 28, bold: true, font: 'Arial',
      color: { scheme: 'tx1', hex: '#000000' } },
  ]);
});

test('artwork keeps its rotation and flips, and a slide number counts as artwork', () => {
  assert.deepEqual(byName('Title Only').artwork, [
    { id: '7', kind: 'pic', bounds: [10, 10, 50, 20], rotation: 90, flipH: true },
    { id: '21', kind: 'sp', placeholder: 'sldNum', bounds: [900, 500, 40, 20] },
  ]);
  assert.deepEqual(measured.masterArtwork, [
    { id: '4', kind: 'sp', placeholder: 'sldNum', bounds: [900, 500, 40, 20] },
    { id: '5', kind: 'sp', bounds: [0, 0, 960, 6] },
  ]);
});

test('names are tidied, and each layout knows its first visible slide and page', () => {
  const titleOnly = byName('Title Only');
  assert.equal(titleOnly.rawName, 'Title Only ');
  assert.deepEqual([titleOnly.used, titleOnly.slide, titleOnly.renderPage, titleOnly.showsMasterArtwork], [true, 3, 2, false]);
  assert.deepEqual([byName('Title Slide').type, byName('Title Slide').renderPage], ['title', 1]);
  assert.deepEqual([byName('Blank').used, byName('Blank').slide, byName('Blank').renderPage], [false, null, null]);
  assert.deepEqual(measured.slides, [
    { slide: 1, hidden: false, renderPage: 1, layout: 'light-layout-001' },
    { slide: 2, hidden: true, renderPage: null, layout: 'light-layout-002' },
    { slide: 3, hidden: false, renderPage: 2, layout: 'light-layout-002' },
  ]);
});

test('another master can be chosen by number or part, and an unknown one is refused', () => {
  const legacy = measureTemplate(makeTemplate(), { variant: 'light', master: '1' });
  assert.deepEqual(legacy.layouts.map((layout) => layout.name), ['Legacy']);
  assert.equal(legacy.chosenBy, 'option');
  assert.equal(measureTemplate(makeTemplate(), { variant: 'light', master: 'ppt/slideMasters/slideMaster1.xml' }).layouts.length, 1);
  assert.throws(() => measureTemplate(makeTemplate(), { variant: 'light', master: '9' }),
    /no master 9\. Its masters are: 1 \(ppt\/slideMasters\/slideMaster1\.xml\), 2/);
});

test('what is not a template, or not a variant name, is refused', () => {
  assert.throws(() => measureTemplate(makeTemplate(), { variant: 'Light Theme' }), /variant is lower-case/);
  assert.throws(() => measureTemplate(writeZip([['word/document.xml', '<w/>']]), { variant: 'light' }), /not a PowerPoint presentation/);
  assert.throws(() => measureTemplate(Buffer.from('nope'), { variant: 'light' }), /not a ZIP archive/);
});

test('measuring again keeps what was added to a layout, and its preview while the template is the same', () => {
  const first = mergeLayouts(null, 'light', measured);
  const titleOnly = first.variants.light.layouts[1];
  Object.assign(titleOnly, { relationship: 'statement', searchTerms: ['one idea'], preview: 'previews/light/light-layout-002.png' });
  const again = mergeLayouts(first, 'light', measureTemplate(makeTemplate(), { variant: 'light' }));
  assert.deepEqual(again.variants.light.layouts[1].searchTerms, ['one idea']);
  assert.equal(again.variants.light.layouts[1].preview, 'previews/light/light-layout-002.png');
  const changed = mergeLayouts(first, 'light', { ...measured, sha256: '0'.repeat(64) });
  assert.equal(changed.variants.light.layouts[1].relationship, 'statement');
  assert.equal(changed.variants.light.layouts[1].preview, undefined);
  const both = mergeLayouts(first, 'dark', { ...measured, template: 'templates/dark.pptx' });
  assert.deepEqual(Object.keys(both.variants), ['dark', 'light']);
  assert.equal(both.schema, 1);
});

test('a placeholder inherits from a master placeholder of its own family, never a date or footer', () => {
  const tricky = measureTemplate(makeTemplate({ tricky: true }), { variant: 'light' });
  const subtitle = tricky.layouts[0].placeholders[1];
  assert.deepEqual(subtitle, { id: '11', type: 'subTitle', idx: '2', bounds: [48, 120, 864, 360], inherited: true, size: 20,
    color: { hex: '#333333' } });
});

test('a master placeholder\'s own style outranks the master\'s text styles, and a layout\'s colour map and adjusted colours are kept', () => {
  const tricky = measureTemplate(makeTemplate({ tricky: true }), { variant: 'light' });
  assert.deepEqual(tricky.layouts[1].placeholders[0], { id: '20', type: 'title', bounds: [48, 36, 864, 60], inherited: true,
    size: 32, bold: true, font: 'Arial', color: { scheme: 'tx1', hex: '#ffffff' } });
  assert.deepEqual(tricky.layouts[0].placeholders[0].color, { scheme: 'accent1', hex: '#1f4e8c', adjusted: true });
});

test('a layout renumbered when the template was saved keeps what was added; one renamed is reported as lost', () => {
  const first = mergeLayouts(null, 'light', measured);
  first.variants.light.layouts[1].relationship = 'statement';
  const renumbered = { ...measured, layouts: measured.layouts.map((layout) => (layout.name === 'Title Only'
    ? { ...layout, part: 'ppt/slideLayouts/slideLayout9.xml' } : layout)) };
  assert.equal(mergeLayouts(first, 'light', renumbered).variants.light.layouts[1].relationship, 'statement');
  assert.deepEqual(lostLayouts(first, 'light', renumbered), []);
  const renamed = { ...measured, layouts: measured.layouts.map((layout) => (layout.name === 'Title Only'
    ? { ...layout, name: 'Headline' } : layout)) };
  assert.equal(mergeLayouts(first, 'light', renamed).variants.light.layouts[1].relationship, undefined);
  assert.deepEqual(lostLayouts(first, 'light', renamed), [{ id: 'light-layout-002', name: 'Title Only',
    part: 'ppt/slideLayouts/slideLayout2.xml', fields: ['relationship'] }]);
});

test('a template with no visible slide measures its first master and says so', () => {
  const noSlides = measureTemplate(makeTemplate({ slides: false }), { variant: 'light' });
  assert.equal(noSlides.chosenBy, 'first');
  assert.equal(noSlides.master, 'ppt/slideMasters/slideMaster1.xml');
});
