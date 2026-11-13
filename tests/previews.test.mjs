import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { drawPreviews, findTool, libreOfficeRenderer } from '../scripts/lib/pack/previews.mjs';
import { measureTemplate, mergeLayouts } from '../scripts/lib/pack/measure.mjs';
import { makeTemplate } from './fixtures/template.mjs';

const PNG = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 1, 2, 3]);

function pack() {
  const folder = mkdtempSync(join(tmpdir(), 'hb-previews-'));
  const template = makeTemplate();
  mkdirSync(join(folder, 'templates'));
  writeFileSync(join(folder, 'templates', 'light.pptx'), template);
  writeFileSync(join(folder, 'layouts.json'), JSON.stringify(mergeLayouts(null, 'light', measureTemplate(template, { variant: 'light' }))));
  return folder;
}

test('each layout with an example slide gets the picture of its page', () => {
  const folder = pack();
  const asked = [];
  const result = drawPreviews(folder, 'light', (template, pages, visible) => {
    asked.push([template.endsWith('templates/light.pptx'), pages, visible]);
    return new Map(pages.map((page) => [page, PNG]));
  });
  assert.deepEqual(asked, [[true, [1, 2], 2]]);
  assert.deepEqual(result, { drawn: 2, without: 1 });
  const layouts = JSON.parse(readFileSync(join(folder, 'layouts.json'), 'utf8')).variants.light.layouts;
  assert.deepEqual(layouts.map((layout) => layout.preview),
    ['previews/light/light-layout-001.png', 'previews/light/light-layout-002.png', undefined]);
  assert.deepEqual(readFileSync(join(folder, 'previews', 'light', 'light-layout-002.png')), PNG);
  assert.ok(!existsSync(join(folder, 'previews', 'light', 'light-layout-003.png')));
});

test('what cannot be drawn is refused in a sentence', () => {
  const folder = pack();
  assert.throws(() => drawPreviews(folder, 'dark', () => new Map()), /no variant dark\. Its variants are: light/);
  assert.throws(() => drawPreviews(folder, 'light', (t, pages) => new Map(pages.map((page) => [page, Buffer.from('GIF89a')]))),
    /Page 1 was not drawn as a PNG/);
  assert.throws(() => drawPreviews(mkdtempSync(join(tmpdir(), 'hb-empty-')), 'light', () => new Map()), /has no layouts\.json/);
});

test('a program named outright must be one that can be run', () => {
  const folder = mkdtempSync(join(tmpdir(), 'hb-tool-'));
  writeFileSync(join(folder, 'not-a-program'), 'text');
  assert.throws(() => findTool('soffice', join(folder, 'not-a-program')), /is not a program that can be run/);
  assert.equal(findTool('node', process.execPath), process.execPath);
});

test('a layouts.json that points outside the pack is refused before anything is drawn', () => {
  const folder = pack();
  const index = join(folder, 'layouts.json');
  const layouts = JSON.parse(readFileSync(index, 'utf8'));
  let drew = false;
  const render = () => { drew = true; return new Map(); };
  writeFileSync(index, JSON.stringify({ ...layouts, variants: { light: { ...layouts.variants.light, template: '../outside.pptx' } } }));
  assert.throws(() => drawPreviews(folder, 'light', render), /must be templates\/light\.pptx/);
  const escaping = structuredClone(layouts);
  escaping.variants.light.layouts[0].id = '../escape';
  writeFileSync(index, JSON.stringify(escaping));
  assert.throws(() => drawPreviews(folder, 'light', render), /layout id that cannot name a file: \.\.\/escape/);
  assert.equal(drew, false);
  assert.throws(() => drawPreviews(folder, 'constructor', render), /no variant constructor/);
});

test('pictures are checked before any is written, and pictures no layout uses any more are removed', () => {
  const folder = pack();
  const half = (t, pages) => new Map(pages.map((page) => [page, page === 2 ? Buffer.from('GIF89a') : PNG]));
  assert.throws(() => drawPreviews(folder, 'light', half), /Page 2 was not drawn as a PNG\. Nothing was written/);
  assert.ok(!existsSync(join(folder, 'previews', 'light', 'light-layout-001.png')));
  drawPreviews(folder, 'light', (t, pages) => new Map(pages.map((page) => [page, PNG])));
  assert.ok(existsSync(join(folder, 'previews', 'light', 'light-layout-002.png')));
  drawPreviews(folder, 'light', () => new Map([[1, PNG]]));
  assert.ok(!existsSync(join(folder, 'previews', 'light', 'light-layout-002.png')));
  assert.ok(existsSync(join(folder, 'previews', 'light', 'light-layout-001.png')));
});

test('the LibreOffice renderer runs the programs as it should', () => {
  const tools = mkdtempSync(join(tmpdir(), 'hb-tools-'));
  const log = join(tools, 'log');
  const script = (name, body) => {
    writeFileSync(join(tools, name), `#!/bin/sh\n${body}\n`, { mode: 0o755 });
    return join(tools, name);
  };
  const soffice = script('soffice', `echo "soffice $*" >> "${log}"\nwhile [ "$1" != "--outdir" ]; do shift; done\n`
    + `out="$2"; shift 2\nname=$(basename "$1" .pptx)\nprintf '%%PDF' > "$out/$name.pdf"`);
  const pdfinfo = script('pdfinfo', 'echo "Pages:          2"');
  const pdftoppm = script('pdftoppm', `echo "pdftoppm $*" >> "${log}"\nfor last; do :; done\n`
    + `printf '\\211PNG\\r\\n\\032\\n' > "$last.png"`);
  const render = libreOfficeRenderer({ soffice, pdftoppm, pdfinfo });
  const drawn = render(join(tools, 'light.pptx'), [1, 2], 2);
  assert.deepEqual([...drawn.keys()], [1, 2]);
  assert.ok(drawn.get(2).subarray(0, 8).equals(PNG.subarray(0, 8)));
  const said = readFileSync(log, 'utf8');
  assert.match(said, /soffice -env:UserInstallation=file:\/\/\/\S+ --headless --convert-to pdf --outdir \S+ \S+light\.pptx/);
  assert.match(said, /pdftoppm -f 2 -l 2 -singlefile -scale-to 960 -png \S+light\.pdf \S+page-2/);
  assert.throws(() => render(join(tools, 'light.pptx'), [1], 3), /drew 2 pages but the template has 3 visible slides/);
  assert.throws(() => findTool('soffice', tools), /is not a program that can be run/);
  assert.equal(findTool('sh', 'sh'), findTool('sh'));
});

test('a program that fails is reported with what it said on stderr', () => {
  const tools = mkdtempSync(join(tmpdir(), 'hb-fail-'));
  writeFileSync(join(tools, 'soffice'), '#!/bin/sh\necho "convert x -> y"\necho "Error: source file could not be loaded" >&2\nexit 1\n', { mode: 0o755 });
  writeFileSync(join(tools, 'pdftoppm'), '#!/bin/sh\nexit 0\n', { mode: 0o755 });
  const render = libreOfficeRenderer({ soffice: join(tools, 'soffice'), pdftoppm: join(tools, 'pdftoppm'), pdfinfo: join(tools, 'pdftoppm') });
  assert.throws(() => render(join(tools, 'light.pptx'), [1], 1), /LibreOffice failed \(exit 1\): Error: source file could not be loaded\./);
});

test('a damaged layouts.json is refused in a sentence', () => {
  const folder = pack();
  const index = join(folder, 'layouts.json');
  writeFileSync(index, '{ not json');
  assert.throws(() => drawPreviews(folder, 'light', () => new Map()), /layouts\.json cannot be read as JSON/);
  const layouts = JSON.parse(JSON.stringify(mergeLayouts(null, 'light', measureTemplate(makeTemplate(), { variant: 'light' }))));
  delete layouts.variants.light.slides;
  writeFileSync(index, JSON.stringify(layouts));
  assert.throws(() => drawPreviews(folder, 'light', () => new Map()), /has no list of slides/);
});
