// The brand audit of a finished PowerPoint deck, from the pack's audit.json: every slide read,
// each finding tied to its slide number, PASS, WARN or BLOCKED. It reads the deck and changes nothing.
import { readFileSync } from 'node:fs';
import { attr, child, children, descendants, EMU_PER_PT, find, local, openPackage, relationId } from '../ooxml.mjs';
import { sha256 } from '../pack/check.mjs';
import { packJson } from './brands.mjs';

export const DEFAULTS = {
  minTextPt: 18, maxWords: 60, textLedWords: 45, outOfBoundsInches: 0.02,
  starterText: ['click to add', 'click to edit', 'lorem ipsum'],
};
const EMU_PER_INCH = 914400;
// Harness Slides names the caption-size lines it places itself by these endings: a slide's source
// and caveat, a chart's source, an edge's label and a state badge.
const CAPTION = /_(source|caveat|caveat_label|label|state)(_\d+)?$/;
const CHROME = new Set(['ftr', 'hdr', 'dt', 'sldNum']);
const THEME_FONTS = /^\+(mj|mn)-(lt|ea|cs)$/;
const VISUAL = new Set(['pic', 'graphicFrame', 'cxnSp']);

const wordsIn = (text) => (String(text).match(/[\p{L}\p{N}][\p{L}\p{N}'’.-]*/gu) ?? []).length;

/** The text of a shape's paragraphs, and the explicit sizes and fonts of its runs. */
function textOf(shape) {
  // A shape's own text body, or every cell of a table.
  const bodies = local(shape.name) === 'sp' ? [child(shape, 'txBody')].filter(Boolean) : descendants(shape, 'txBody');
  if (!bodies.length) return null;
  const paragraphs = bodies.flatMap((body) => children(body, 'p').map((p) => descendants(p, 't').map((t) => t.text ?? '').join('')));
  const sizes = [];
  const fonts = new Set();
  for (const props of bodies.flatMap((body) => [...descendants(body, 'rPr'), ...descendants(body, 'defRPr'), ...descendants(body, 'endParaRPr')])) {
    const size = Number(attr(props, 'sz'));
    if (Number.isFinite(size) && size > 0) sizes.push({ size: size / 100, run: local(props.name) === 'rPr' });
    const latin = child(props, 'latin');
    if (latin && attr(latin, 'typeface')) fonts.add(attr(latin, 'typeface'));
  }
  return { text: paragraphs.join('\n'), sizes, fonts };
}

const frameOf = (shape) => find(shape, 'spPr/xfrm') ?? find(shape, 'grpSpPr/xfrm') ?? child(shape, 'xfrm');

/** The audit of the deck in `file` for a chosen pack ({pack, brand, variant} from choose()). */
export function auditDeck(file, chosen) {
  const data = readFileSync(file);
  const { pack, brand, variant } = chosen;
  const settings = brand.variants[variant];
  let given = {};
  try { given = packJson(pack, 'audit.json'); } catch { given = {}; }
  const limits = { ...DEFAULTS, ...given };
  const captionPt = settings.slides?.typography?.caption?.size ?? limits.minTextPt;
  const fonts = new Set((limits.fonts ?? [brand.fonts.sans, brand.fonts.mono ?? 'Courier New']).map((each) => each.toLowerCase()));
  const layoutNames = new Set();
  try {
    for (const layout of packJson(pack, 'layouts.json').variants[variant]?.layouts ?? []) layoutNames.add(layout.rawName ?? layout.name);
  } catch { /* a brand for writing only has no template to compare with */ }
  const starter = new RegExp(`${limits.starterText.map((each) => each.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('|')}|\\{\\{[^{}]+\\}\\}`, 'i');

  const deck = openPackage(data);
  const presentation = deck.xml('ppt/presentation.xml');
  const size = find(presentation, 'sldSz');
  const width = Number(attr(size, 'cx'));
  const height = Number(attr(size, 'cy'));
  const slack = limits.outOfBoundsInches * EMU_PER_INCH;
  const findings = [];
  const issue = (ruleId, slide, shapeId, severity, observed, remediation) => findings.push({ ruleId, slide, shapeId, severity, observed, remediation });
  const slides = [];
  const ids = children(find(presentation, 'sldIdLst'), 'sldId');
  ids.forEach((entry, at) => {
    const number = at + 1;
    const part = deck.target('ppt/presentation.xml', relationId(entry));
    const root = deck.xml(part);
    const tree = find(root, 'cSld/spTree');
    const layoutPart = deck.related(part, 'slideLayout');
    const layoutName = layoutPart ? attr(find(deck.xml(layoutPart), 'cSld'), 'name') ?? '' : '';
    const stats = { slide: number, words: 0, textObjects: 0, minFontPt: null };
    let visuals = 0;
    if (layoutNames.size && layoutName && !layoutNames.has(layoutName)) {
      issue('BRAND_LAYOUT_UNKNOWN', number, null, 'warning', layoutName,
        `This slide uses the layout "${layoutName}", which is not in the ${brand.name} ${variant} template. Rebuild it on the brand's layouts.`);
    }
    const kinds = ['sp', 'pic', 'graphicFrame', 'cxnSp', 'grpSp'];
    const shapes = kinds.flatMap((each) => descendants(tree, each));
    // A shape inside a group is placed in the group's own coordinates, so only top-level shapes are held to the slide's edges.
    const grouped = new Set(descendants(tree, 'grpSp').flatMap((group) => kinds.flatMap((each) => descendants(group, each))));
    for (const shape of shapes) {
      const kind = local(shape.name);
      const props = find(shape, 'nvSpPr/cNvPr') ?? find(shape, 'nvPicPr/cNvPr') ?? find(shape, 'nvGraphicFramePr/cNvPr') ?? find(shape, 'nvCxnSpPr/cNvPr') ?? find(shape, 'nvGrpSpPr/cNvPr');
      const shapeId = attr(props, 'id') ?? null;
      const name = attr(props, 'name') ?? '';
      if (VISUAL.has(kind) || (kind === 'sp' && child(find(shape, 'spPr'), 'custGeom'))) visuals += 1;
      const frame = frameOf(shape);
      const off = child(frame, 'off');
      const ext = child(frame, 'ext');
      if (off && ext && !grouped.has(shape)) {
        const [x, y, cx, cy] = [attr(off, 'x'), attr(off, 'y'), attr(ext, 'cx'), attr(ext, 'cy')].map(Number);
        if (x < -slack || y < -slack || x + cx > width + slack || y + cy > height + slack) {
          issue('OUT_OF_BOUNDS', number, shapeId, 'warning', { x, y, cx, cy }, 'Bring this shape inside the slide, or remove it.');
        }
      }
      if (kind !== 'sp' && kind !== 'graphicFrame') continue;
      // Footers, dates and slide numbers are the template's furniture, not the slide's words.
      if (CHROME.has(attr(descendants(shape, 'ph')[0], 'type'))) continue;
      const text = textOf(shape);
      if (!text || !text.text.trim()) continue;
      stats.textObjects += 1;
      stats.words += wordsIn(text.text);
      if (starter.test(text.text)) {
        issue('UNRESOLVED_PLACEHOLDER', number, shapeId, 'blocker', text.text.slice(0, 80), 'Replace or delete the template text left on this slide.');
      }
      const caption = CAPTION.test(name) || /^caption/i.test(name);
      const floor = caption ? captionPt : limits.minTextPt;
      for (const each of text.sizes) {
        stats.minFontPt = stats.minFontPt === null ? each.size : Math.min(stats.minFontPt, each.size);
      }
      const smallest = text.sizes.filter((each) => each.run).map((each) => each.size).sort((a, b) => a - b)[0];
      if (smallest !== undefined && smallest < floor) {
        issue('SMALL_TEXT', number, shapeId, 'warning', `${smallest} pt`, caption
          ? `Enlarge this caption to ${captionPt} pt, or move the detail to the speaker notes.`
          : `Enlarge this text to at least ${limits.minTextPt} pt, or move the detail to the speaker notes.`);
      }
      for (const font of text.fonts) {
        if (!THEME_FONTS.test(font) && !fonts.has(font.toLowerCase())) {
          issue('FONT_NOT_IN_BRAND', number, shapeId, 'warning', font, `Set this text in ${[...fonts].join(' or ')}.`);
        }
      }
    }
    if (stats.words > limits.maxWords) {
      issue('HIGH_TEXT_DENSITY', number, null, 'warning', `${stats.words} words`, `Cut this slide to ${limits.maxWords} words or fewer, or split it.`);
    } else if (stats.words > limits.textLedWords && !visuals) {
      issue('TEXT_LED_SLIDE', number, null, 'warning', `${stats.words} words and no picture, chart, table or diagram`,
        'Show the idea as a diagram, chart or picture, or cut the words.');
    }
    slides.push(stats);
  });
  const blockers = findings.filter((each) => each.severity === 'blocker');
  const warnings = findings.filter((each) => each.severity === 'warning');
  return {
    schemaVersion: 1, file, sha256: sha256(data), status: blockers.length ? 'BLOCKED' : warnings.length ? 'WARN' : 'PASS',
    coverage: { slides: slides.length, rules: ['UNRESOLVED_PLACEHOLDER', 'SMALL_TEXT', 'HIGH_TEXT_DENSITY', 'TEXT_LED_SLIDE', 'FONT_NOT_IN_BRAND', 'OUT_OF_BOUNDS', 'BRAND_LAYOUT_UNKNOWN'],
      notChecked: 'Colour contrast, inherited text sizes and artwork are judged by rendered review.' },
    thresholds: { maxWords: limits.maxWords, minTextPt: limits.minTextPt, captionPt, textLedWords: limits.textLedWords },
    slides, blockers, warnings, brand: brand.id, variant,
  };
}
