// Previews of a pack's layouts: the template drawn by LibreOffice and Poppler, one picture for
// each layout that a visible slide uses, kept as previews/<variant>/<layout id>.png.
import { spawnSync } from 'node:child_process';
import {
  accessSync, constants, existsSync, mkdtempSync, mkdirSync, readFileSync, readdirSync, renameSync, rmSync, statSync,
  unlinkSync, writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { delimiter, isAbsolute, join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { readableJson } from '../readable-json.mjs';
import { readLayouts } from './layouts-file.mjs';

const PNG = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
const WAIT = 300_000;   // milliseconds LibreOffice may take for one template
const PLACES = { soffice: ['/Applications/LibreOffice.app/Contents/MacOS/soffice'] };
const NAME = /^[a-z0-9][a-z0-9._-]*$/i;   // a variant or layout id that is safe as a file name

const runnable = (place) => {
  try {
    accessSync(place, constants.X_OK);
    return statSync(place).isFile();
  } catch {
    return false;
  }
};

/** The path of a program: the one given (a path, or a name looked up on PATH), else the
 *  first on PATH, else a usual install place. */
export function findTool(name, given) {
  const onPath = (program) => String(process.env.PATH ?? '').split(delimiter).filter(Boolean)
    .map((dir) => join(dir, program)).find(runnable) ?? null;
  if (given) {
    const found = given.includes('/') || isAbsolute(given) ? (runnable(given) ? given : null) : onPath(given);
    if (!found) throw new Error(`${given} is not a program that can be run.`);
    return found;
  }
  return onPath(name) ?? (PLACES[name] ?? []).find(runnable) ?? null;
}

function run(tool, args, what) {
  const done = spawnSync(tool, args, { encoding: 'utf8', timeout: WAIT });
  if (done.error || done.status !== 0) {
    // The complaint is on stderr (LibreOffice prints its progress on stdout); stdout only when stderr says nothing.
    const lines = (text) => String(text ?? '').split('\n').map((line) => line.trim()).filter((line) => line && !/^Fontconfig/.test(line));
    const said = (lines(done.stderr).pop() ?? lines(done.stdout).pop() ?? lines(done.error?.message).pop())?.replace(/\.$/, '');
    const how = done.error ? '' : done.signal ? ` (stopped by ${done.signal})` : ` (exit ${done.status})`;
    throw new Error(`${what} failed${how}${said ? `: ${said}` : ''}.`);
  }
  return done.stdout;
}

/** A renderer for drawPreviews, with LibreOffice, pdftoppm and (when found) pdfinfo. */
export function libreOfficeRenderer({ soffice, pdftoppm, pdfinfo } = {}) {
  const office = findTool('soffice', soffice);
  const raster = findTool('pdftoppm', pdftoppm);
  if (!office || !raster) {
    throw new Error('Previews need LibreOffice (soffice) and Poppler (pdftoppm). Install them, or give --soffice and --pdftoppm.');
  }
  const info = findTool('pdfinfo', pdfinfo);
  return (template, pages, visible) => {
    const work = mkdtempSync(join(tmpdir(), 'harness-brand-previews-'));
    try {
      run(office, [`-env:UserInstallation=${pathToFileURL(join(work, 'profile')).href}`, '--headless',
        '--convert-to', 'pdf', '--outdir', work, template], 'LibreOffice');
      const pdf = join(work, template.split(/[\\/]/).pop().replace(/\.[^.]+$/, '.pdf'));
      if (!existsSync(pdf)) throw new Error('LibreOffice made no PDF of the template.');
      if (info) {
        const count = Number(/^Pages:\s+(\d+)/m.exec(run(info, [pdf], 'pdfinfo'))?.[1]);
        if (!Number.isInteger(count)) throw new Error('pdfinfo did not say how many pages the PDF has.');
        if (count !== visible) {
          throw new Error(`LibreOffice drew ${count} pages but the template has ${visible} visible slides, so pages and slides would not match.`);
        }
      }
      const drawn = new Map();
      for (const page of pages) {
        const stem = join(work, `page-${page}`);
        run(raster, ['-f', String(page), '-l', String(page), '-singlefile', '-scale-to', '960', '-png', pdf, stem], 'pdftoppm');
        drawn.set(page, readFileSync(`${stem}.png`));
      }
      return drawn;
    } finally {
      rmSync(work, { recursive: true, force: true });
    }
  };
}

function put(file, data) {
  writeFileSync(`${file}.tmp`, data);
  renameSync(`${file}.tmp`, file);
}

/** Draw the previews for one variant of the pack in `pack` with `render(template, pages,
 *  visibleSlides)`, which returns a Map of page number to PNG. Every picture is checked before
 *  any is written; then the pictures, the layouts' `preview` fields, and the removal of
 *  pictures no layout uses any more. Returns {drawn, without}. */
export function drawPreviews(pack, variant, render) {
  const index = join(pack, 'layouts.json');
  if (!existsSync(index)) throw new Error(`${pack} has no layouts.json. Measure a template first with pack measure.`);
  const layouts = readLayouts(index);
  const variants = layouts.variants ?? {};
  if (!Object.hasOwn(variants, variant)) {
    throw new Error(`layouts.json has no variant ${variant}. Its variants are: ${Object.keys(variants).join(', ') || 'none'}.`);
  }
  if (!NAME.test(variant)) throw new Error(`The variant ${variant} cannot name a folder.`);
  const measured = variants[variant];
  if (!Array.isArray(measured.slides)) throw new Error(`layouts.json's variant ${variant} has no list of slides. Measure it again with pack measure.`);
  // The template is always the pack's own templates/<variant>.pptx, whatever layouts.json says.
  if (measured.template !== `templates/${variant}.pptx`) {
    throw new Error(`layouts.json gives ${variant}'s template as ${measured.template}; it must be templates/${variant}.pptx.`);
  }
  const bad = measured.layouts.find((layout) => !NAME.test(String(layout.id ?? '')));
  if (bad) throw new Error(`layouts.json has a layout id that cannot name a file: ${bad.id}.`);
  const template = join(pack, measured.template);
  if (!existsSync(template)) throw new Error(`${pack} has no ${measured.template}.`);
  const pages = [...new Set(measured.layouts.map((layout) => layout.renderPage).filter(Number.isInteger))].sort((a, b) => a - b);
  const visible = measured.slides.filter((slide) => !slide.hidden).length;
  const drawn = render(template, pages, visible);
  for (const page of pages) {
    const picture = drawn.get(page);
    if (picture && !picture.subarray(0, 8).equals(PNG)) throw new Error(`Page ${page} was not drawn as a PNG. Nothing was written.`);
  }
  const folder = join(pack, 'previews', variant);
  mkdirSync(folder, { recursive: true });
  const kept = new Set();
  for (const layout of measured.layouts) {
    const picture = Number.isInteger(layout.renderPage) ? drawn.get(layout.renderPage) : null;
    if (!picture) { delete layout.preview; continue; }
    put(join(folder, `${layout.id}.png`), picture);
    layout.preview = `previews/${variant}/${layout.id}.png`;
    kept.add(`${layout.id}.png`);
  }
  put(index, readableJson(layouts));
  for (const file of readdirSync(folder)) {
    if (file.endsWith('.png') && !kept.has(file)) unlinkSync(join(folder, file));
  }
  return { drawn: kept.size, without: measured.layouts.length - kept.size };
}
