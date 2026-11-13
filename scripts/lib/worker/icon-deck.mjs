// The native icon deck Harness Slides copies icons from: each glyph of an icon library drawn as
// PowerPoint geometry (a filled disc and the glyph in white on it), with the index that says
// where each icon is. Made from the library alone, the same bytes every time.
import { mkdirSync, readFileSync, renameSync, writeFileSync, existsSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { parsePath } from '../svg-path.mjs';
import { readZip, writeZip } from '../zip.mjs';
import { sha256 } from '../pack/check.mjs';

export const DECK_VERSION = 1;   // raised whenever the deck's drawing changes, so caches are rebuilt
const SLIDE = { cx: 12192000, cy: 6858000 };
const DISC = 1097100;            // EMU: the size of each icon on its slide
const COLUMNS = 8;
const ROWS = 4;
const PER_SLIDE = COLUMNS * ROWS;
const GAP = { x: 342900, y: 400050 };
const UNITS = 1000;              // path units per library unit (the library draws in 0 0 100 100)
const SCALE = 100 * UNITS;

const escape = (text) => String(text).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

/** A library and its icons, in index order: {library, icons:[{slug, name, category, keywords, paths | file}]}. */
export function readLibrary(archive) {
  const files = readZip(archive);
  const library = JSON.parse(files.get('library.json').toString('utf8'));
  const { icons } = JSON.parse(files.get('icons.json').toString('utf8'));
  return { library, icons };
}

/** A glyph library's icons; a picture library is refused, since only glyphs are drawn as native geometry. */
export function readGlyphs(archive) {
  const read = readLibrary(archive);
  if (read.library.kind !== 'glyph') throw new Error(`The icon library ${read.library.id} holds pictures; only glyph icons are drawn as native geometry.`);
  return read;
}

/** Where icon `n` (from 0) of a deck sits: its slide (from 1) and its box in EMU. */
export function placeOf(n) {
  const slide = Math.floor(n / PER_SLIDE) + 1;
  const at = n % PER_SLIDE;
  const width = COLUMNS * DISC + (COLUMNS - 1) * GAP.x;
  const height = ROWS * DISC + (ROWS - 1) * GAP.y;
  const x = Math.round((SLIDE.cx - width) / 2) + (at % COLUMNS) * (DISC + GAP.x);
  const y = Math.round((SLIDE.cy - height) / 2) + Math.floor(at / COLUMNS) * (DISC + GAP.y);
  return { slide, bounds: [x, y, DISC, DISC], shapeIds: [String(2 + 2 * (at)), String(3 + 2 * at)] };
}

/** The stable id an icon is known by: the library id and the icon's slug. */
export const iconId = (library, slug) => `${library}.${slug}`;

function pathXml(d) {
  const point = ([x, y]) => `<a:pt x="${Math.round(x * UNITS)}" y="${Math.round(y * UNITS)}"/>`;
  const steps = parsePath(d).map((seg) => {
    if (seg.op === 'M') return `<a:moveTo>${point(seg.pts[0])}</a:moveTo>`;
    if (seg.op === 'L') return `<a:lnTo>${point(seg.pts[0])}</a:lnTo>`;
    if (seg.op === 'C') return `<a:cubicBezTo>${seg.pts.map(point).join('')}</a:cubicBezTo>`;
    return '<a:close/>';
  });
  return `<a:path w="${SCALE}" h="${SCALE}">${steps.join('')}</a:path>`;
}

function shape(id, name, [x, y, cx, cy], geometry, fill) {
  return `<p:sp><p:nvSpPr><p:cNvPr id="${id}" name="${escape(name)}"/><p:cNvSpPr/><p:nvPr/></p:nvSpPr>`
    + `<p:spPr><a:xfrm><a:off x="${x}" y="${y}"/><a:ext cx="${cx}" cy="${cy}"/></a:xfrm>${geometry}`
    + `<a:solidFill><a:srgbClr val="${fill}"/></a:solidFill><a:ln><a:noFill/></a:ln></p:spPr></p:sp>`;
}

const NS = 'xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships" xmlns:p="http://schemas.openxmlformats.org/presentationml/2006/main"';
const HEAD = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n';
const REL = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships';
const PKG = 'http://schemas.openxmlformats.org/package/2006/relationships';
const TREE = '<p:nvGrpSpPr><p:cNvPr id="1" name=""/><p:cNvGrpSpPr/><p:nvPr/></p:nvGrpSpPr><p:grpSpPr><a:xfrm><a:off x="0" y="0"/><a:ext cx="0" cy="0"/><a:chOff x="0" y="0"/><a:chExt cx="0" cy="0"/></a:xfrm></p:grpSpPr>';

function theme() {
  const colour = (name, hex) => `<a:${name}><a:srgbClr val="${hex}"/></a:${name}>`;
  const font = '<a:latin typeface="Arial"/><a:ea typeface=""/><a:cs typeface=""/>';
  const style = '<a:solidFill><a:schemeClr val="phClr"/></a:solidFill>';
  return `${HEAD}<a:theme ${NS} name="Harness Brand icons"><a:themeElements><a:clrScheme name="Harness Brand icons">`
    + `${colour('dk1', '000000')}${colour('lt1', 'FFFFFF')}${colour('dk2', '1B1D36')}${colour('lt2', 'EEEEEE')}`
    + `${['005C8A', '007B8C', '0098C7', '61A60E', '6C4B94', 'F3BA16'].map((hex, i) => colour(`accent${i + 1}`, hex)).join('')}`
    + `${colour('hlink', '0098C7')}${colour('folHlink', '6C4B94')}</a:clrScheme>`
    + `<a:fontScheme name="Arial"><a:majorFont>${font}</a:majorFont><a:minorFont>${font}</a:minorFont></a:fontScheme>`
    + `<a:fmtScheme name="Plain"><a:fillStyleLst>${style}${style}${style}</a:fillStyleLst>`
    + '<a:lnStyleLst><a:ln w="6350"><a:solidFill><a:schemeClr val="phClr"/></a:solidFill></a:ln><a:ln w="12700"><a:solidFill><a:schemeClr val="phClr"/></a:solidFill></a:ln><a:ln w="19050"><a:solidFill><a:schemeClr val="phClr"/></a:solidFill></a:ln></a:lnStyleLst>'
    + '<a:effectStyleLst><a:effectStyle><a:effectLst/></a:effectStyle><a:effectStyle><a:effectLst/></a:effectStyle><a:effectStyle><a:effectLst/></a:effectStyle></a:effectStyleLst>'
    + `<a:bgFillStyleLst>${style}${style}${style}</a:bgFillStyleLst></a:fmtScheme></a:themeElements></a:theme>`;
}

/** The deck and its index for a glyph library, with the disc in `disc` (#rrggbb).
 *  Returns {deck: Buffer, index: object}; the index's sourceSha256 is the deck's. */
export function buildIconDeck(archive, { disc = '#005C8A' } = {}) {
  const { library, icons } = readGlyphs(archive);
  const fill = disc.replace('#', '').toUpperCase();
  const slides = [];
  const entries = [];
  icons.forEach((icon, n) => {
    const place = placeOf(n);
    const id = iconId(library.id, icon.slug);
    const paths = Array.isArray(icon.paths) ? icon.paths : [icon.d];
    const glyph = `<a:custGeom><a:avLst/><a:gdLst/><a:ahLst/><a:cxnLst/><a:rect l="0" t="0" r="r" b="b"/><a:pathLst>${paths.map(pathXml).join('')}</a:pathLst></a:custGeom>`;
    (slides[place.slide - 1] ??= []).push(shape(place.shapeIds[0], `${id} disc`, place.bounds, '<a:prstGeom prst="ellipse"><a:avLst/></a:prstGeom>', fill)
      + shape(place.shapeIds[1], id, place.bounds, glyph, 'FFFFFF'));
    entries.push({ id, slide: place.slide, label: icon.name, category: icon.category, ...(icon.keywords?.length ? { keywords: icon.keywords } : {}),
      native: true, bounds: place.bounds, shapeIds: place.shapeIds });
  });
  const files = [];
  const count = slides.length;
  files.push(['[Content_Types].xml', `${HEAD}<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">`
    + '<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/>'
    + '<Override PartName="/ppt/presentation.xml" ContentType="application/vnd.openxmlformats-officedocument.presentationml.presentation.main+xml"/>'
    + '<Override PartName="/ppt/slideMasters/slideMaster1.xml" ContentType="application/vnd.openxmlformats-officedocument.presentationml.slideMaster+xml"/>'
    + '<Override PartName="/ppt/slideLayouts/slideLayout1.xml" ContentType="application/vnd.openxmlformats-officedocument.presentationml.slideLayout+xml"/>'
    + '<Override PartName="/ppt/theme/theme1.xml" ContentType="application/vnd.openxmlformats-officedocument.theme+xml"/>'
    + slides.map((_, i) => `<Override PartName="/ppt/slides/slide${i + 1}.xml" ContentType="application/vnd.openxmlformats-officedocument.presentationml.slide+xml"/>`).join('')
    + '</Types>']);
  files.push(['_rels/.rels', `${HEAD}<Relationships xmlns="${PKG}"><Relationship Id="rId1" Type="${REL}/officeDocument" Target="ppt/presentation.xml"/></Relationships>`]);
  files.push(['ppt/presentation.xml', `${HEAD}<p:presentation ${NS}><p:sldMasterIdLst><p:sldMasterId id="2147483648" r:id="rId1"/></p:sldMasterIdLst>`
    + `<p:sldIdLst>${slides.map((_, i) => `<p:sldId id="${256 + i}" r:id="rId${i + 2}"/>`).join('')}</p:sldIdLst>`
    + `<p:sldSz cx="${SLIDE.cx}" cy="${SLIDE.cy}"/><p:notesSz cx="6858000" cy="9144000"/></p:presentation>`]);
  files.push(['ppt/_rels/presentation.xml.rels', `${HEAD}<Relationships xmlns="${PKG}"><Relationship Id="rId1" Type="${REL}/slideMaster" Target="slideMasters/slideMaster1.xml"/>`
    + `${slides.map((_, i) => `<Relationship Id="rId${i + 2}" Type="${REL}/slide" Target="slides/slide${i + 1}.xml"/>`).join('')}`
    + `<Relationship Id="rId${count + 2}" Type="${REL}/theme" Target="theme/theme1.xml"/></Relationships>`]);
  files.push(['ppt/slideMasters/slideMaster1.xml', `${HEAD}<p:sldMaster ${NS}><p:cSld><p:spTree>${TREE}</p:spTree></p:cSld>`
    + '<p:clrMap bg1="lt1" tx1="dk1" bg2="lt2" tx2="dk2" accent1="accent1" accent2="accent2" accent3="accent3" accent4="accent4" accent5="accent5" accent6="accent6" hlink="hlink" folHlink="folHlink"/>'
    + '<p:sldLayoutIdLst><p:sldLayoutId id="2147483649" r:id="rId1"/></p:sldLayoutIdLst></p:sldMaster>']);
  files.push(['ppt/slideMasters/_rels/slideMaster1.xml.rels', `${HEAD}<Relationships xmlns="${PKG}"><Relationship Id="rId1" Type="${REL}/slideLayout" Target="../slideLayouts/slideLayout1.xml"/>`
    + `<Relationship Id="rId2" Type="${REL}/theme" Target="../theme/theme1.xml"/></Relationships>`]);
  files.push(['ppt/slideLayouts/slideLayout1.xml', `${HEAD}<p:sldLayout ${NS} type="blank"><p:cSld name="Blank"><p:spTree>${TREE}</p:spTree></p:cSld></p:sldLayout>`]);
  files.push(['ppt/slideLayouts/_rels/slideLayout1.xml.rels', `${HEAD}<Relationships xmlns="${PKG}"><Relationship Id="rId1" Type="${REL}/slideMaster" Target="../slideMasters/slideMaster1.xml"/></Relationships>`]);
  files.push(['ppt/theme/theme1.xml', theme()]);
  slides.forEach((shapes, i) => {
    files.push([`ppt/slides/slide${i + 1}.xml`, `${HEAD}<p:sld ${NS}><p:cSld><p:spTree>${TREE}${shapes.join('')}</p:spTree></p:cSld></p:sld>`]);
    files.push([`ppt/slides/_rels/slide${i + 1}.xml.rels`, `${HEAD}<Relationships xmlns="${PKG}"><Relationship Id="rId1" Type="${REL}/slideLayout" Target="../slideLayouts/slideLayout1.xml"/></Relationships>`]);
  });
  // Stored, not compressed, so the same library always gives the same bytes, whatever zlib Node carries.
  const deck = writeZip(files, { store: true });
  return { deck, index: { schemaVersion: 1, library: library.id, sourceSha256: sha256(deck), entries } };
}

/** The folder icon decks are kept in: ~/Library/Caches/harness-brand on a Mac, else
 *  $XDG_CACHE_HOME/harness-brand (or ~/.cache/harness-brand). */
export function cacheFolder({ environment = process.env, home = homedir(), platform = process.platform } = {}) {
  if (environment.HARNESS_BRAND_CACHE) return environment.HARNESS_BRAND_CACHE;
  if (platform === 'darwin') return join(home, 'Library', 'Caches', 'harness-brand');
  return join(environment.XDG_CACHE_HOME || join(home, '.cache'), 'harness-brand');
}

/** Whether a kept deck is whole: its index reads, and records the deck's own hash. */
function intact(path, index) {
  try {
    return JSON.parse(readFileSync(index, 'utf8')).sourceSha256 === sha256(readFileSync(path));
  } catch {
    return false;
  }
}

/** The deck and index for this library and disc colour, made once and kept: {path, index}. */
export function iconDeck(libraryZip, { disc, ...where } = {}) {
  const archive = readFileSync(libraryZip);
  const key = sha256(Buffer.concat([archive, Buffer.from(`\n${String(disc).toUpperCase()}\n${DECK_VERSION}`)]));
  const folder = join(cacheFolder(where), key.slice(0, 32));
  const path = join(folder, 'icons.pptx');
  const index = join(folder, 'icons.json');
  if (!intact(path, index)) {
    const built = buildIconDeck(archive, { disc });
    mkdirSync(folder, { recursive: true });
    for (const [file, data] of [[path, built.deck], [index, `${JSON.stringify(built.index, null, 2)}\n`]]) {
      writeFileSync(`${file}.${process.pid}.tmp`, data);
      renameSync(`${file}.${process.pid}.tmp`, file);
    }
  }
  return { path, index };
}
