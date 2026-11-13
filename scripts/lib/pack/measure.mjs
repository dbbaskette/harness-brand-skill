// Measuring a PowerPoint template: the master its slides use, each of that master's layouts
// with its placeholders and artwork, the theme's colours and fonts, and the slides.
import { createHash } from 'node:crypto';
import {
  EMU_PER_PT, attr, child, children, descendant, find, local, openPackage, relationId,
} from '../ooxml.mjs';

const SHAPES = new Set(['sp', 'pic', 'grpSp', 'cxnSp', 'graphicFrame']);
const FURNITURE = new Set(['ftr', 'hdr', 'dt', 'sldNum']);   // placeholders that are template artwork
const PRESENTATION = 'ppt/presentation.xml';

const round = (n) => {
  const v = Math.round(n * 100) / 100;
  return v === 0 ? 0 : v;
};
const pt = (emu) => round(Number(emu) / EMU_PER_PT);
const yes = (value) => value === '1' || value === 'true';
const no = (value) => value === '0' || value === 'false';
const tidy = (text) => String(text ?? '').replace(/\s+/g, ' ').trim();
const family = (type) => (type === 'title' || type === 'ctrTitle' ? 'title'
  : ['body', 'obj', 'subTitle'].includes(type) ? 'body' : type);

function slidesOf(pkg) {
  let page = 0;
  return children(child(pkg.xml(PRESENTATION), 'sldIdLst'), 'sldId').map((entry, n) => {
    const part = pkg.target(PRESENTATION, relationId(entry));
    if (!part) throw new Error(`Slide ${n + 1} is listed but has no part.`);
    const hidden = no(attr(pkg.xml(part), 'show'));
    if (!hidden) page += 1;
    return { slide: n + 1, part, layoutPart: pkg.related(part, 'slideLayout'), hidden, renderPage: hidden ? null : page };
  });
}

function mastersOf(pkg) {
  return children(child(pkg.xml(PRESENTATION), 'sldMasterIdLst'), 'sldMasterId').map((entry, n) => {
    const part = pkg.target(PRESENTATION, relationId(entry));
    if (!part) throw new Error(`Master ${n + 1} is listed but has no part.`);
    const layouts = children(child(pkg.xml(part), 'sldLayoutIdLst'), 'sldLayoutId')
      .map((each) => pkg.target(part, relationId(each))).filter(Boolean);
    return { number: n + 1, part, layouts };
  });
}

/** The master named by `wanted` (its number or part), else the one most visible slides use:
 *  {master, by}, `by` saying why: option, only, slides, or first (no visible slide decides). */
function chooseMaster(masters, slides, wanted) {
  if (!masters.length) throw new Error('It has no slide master.');
  if (wanted !== undefined && wanted !== null) {
    const chosen = masters.find((m) => m.part === wanted || String(m.number) === String(wanted));
    if (!chosen) {
      throw new Error(`It has no master ${wanted}. Its masters are: ${
        masters.map((m) => `${m.number} (${m.part})`).join(', ')}.`);
    }
    return { master: chosen, by: 'option' };
  }
  if (masters.length === 1) return { master: masters[0], by: 'only' };
  const visible = (m) => slides.filter((s) => !s.hidden && m.layouts.includes(s.layoutPart)).length;
  const best = masters.reduce((top, m) => (visible(m) > visible(top) ? m : top));
  return { master: best, by: visible(best) ? 'slides' : 'first' };
}

function themeOf(pkg, masterPart) {
  const part = pkg.related(masterPart, 'theme');
  const theme = { part, colors: {}, fonts: {} };
  if (!part) return theme;
  const root = pkg.xml(part);
  for (const entry of find(root, 'themeElements/clrScheme')?.children ?? []) {
    const value = entry.children[0];
    const raw = local(value?.name) === 'sysClr' ? value.attrs.lastClr : value?.attrs.val;
    if (/^[0-9a-f]{6}$/i.test(raw ?? '')) theme.colors[local(entry.name)] = `#${raw.toLowerCase()}`;
  }
  for (const [key, name] of [['majorFont', 'major'], ['minorFont', 'minor']]) {
    const face = find(root, `themeElements/fontScheme/${key}/latin`)?.attrs.typeface;
    if (face) theme.fonts[name] = face;
  }
  return theme;
}

/** {bounds: [x, y, width, height] in points, rotation?, flipH?, flipV?} from a shape's own frame. */
function frameOf(shape) {
  const xfrm = find(shape, 'spPr/xfrm') ?? child(shape, 'xfrm') ?? find(shape, 'grpSpPr/xfrm');
  const off = child(xfrm, 'off');
  const ext = child(xfrm, 'ext');
  if (!off || !ext) return null;
  const out = { bounds: [pt(off.attrs.x), pt(off.attrs.y), pt(ext.attrs.cx), pt(ext.attrs.cy)] };
  if (Number(xfrm.attrs.rot)) out.rotation = round(Number(xfrm.attrs.rot) / 60000);
  if (xfrm.attrs.flipH === '1') out.flipH = true;
  if (xfrm.attrs.flipV === '1') out.flipV = true;
  return out;
}

const shapesOf = (root) => (find(root, 'cSld/spTree')?.children ?? []).filter((each) => SHAPES.has(local(each.name)));

function placeholderOf(shape) {
  if (local(shape.name) === 'grpSp') return null;
  const ph = descendant(shape, 'ph');
  return ph ? { type: ph.attrs.type ?? 'obj', idx: ph.attrs.idx } : null;
}

/** The master placeholder a layout placeholder inherits from, as PowerPoint finds it: one of
 *  the same family (title, or body), preferring the same type and idx, then the same type,
 *  then the same idx. A date, footer or slide number never stands in for content. */
function inheritFrom(masterPlaceholders, { type, idx }) {
  const same = masterPlaceholders.filter((each) => family(each.type) === family(type));
  return same.find((each) => each.type === type && each.idx === idx)
    ?? same.find((each) => each.type === type)
    ?? same.find((each) => idx !== undefined && each.idx === idx)
    ?? same[0] ?? null;
}

function runStyle(defRPr) {
  if (!defRPr) return {};
  const out = {};
  if (defRPr.attrs.sz) out.size = Number(defRPr.attrs.sz) / 100;
  if (defRPr.attrs.b !== undefined) out.bold = yes(defRPr.attrs.b);
  const face = child(defRPr, 'latin')?.attrs.typeface;
  if (face) out.font = face;
  const fill = child(defRPr, 'solidFill')?.children[0];
  if (fill) {
    const kind = local(fill.name);
    out.color = kind === 'schemeClr' ? { scheme: fill.attrs.val } : { value: kind === 'sysClr' ? fill.attrs.lastClr : fill.attrs.val };
    // A lightened, darkened or see-through colour: `hex` is the colour it is made from.
    if (fill.children.length) out.color.adjusted = true;
  }
  return out;
}

/** The text style a placeholder's first level shows: the first value found for each of size,
 *  bold, font and colour along the shape, its master placeholder, the master's text styles
 *  and the presentation's default. */
function textStyle(chain, theme, colorMap) {
  const out = {};
  for (const node of chain) {
    for (const [key, value] of Object.entries(runStyle(node))) if (out[key] === undefined) out[key] = value;
  }
  if (out.font === '+mj-lt') out.font = theme.fonts.major ?? out.font;
  if (out.font === '+mn-lt') out.font = theme.fonts.minor ?? out.font;
  if (out.color) {
    const { adjusted } = out.color;
    if (out.color.scheme) {
      const mapped = colorMap[out.color.scheme] ?? out.color.scheme;
      out.color = { scheme: out.color.scheme, hex: theme.colors[mapped] ?? null };
    } else {
      out.color = { hex: /^[0-9a-f]{6}$/i.test(out.color.value ?? '') ? `#${out.color.value.toLowerCase()}` : null };
    }
    if (adjusted) out.color.adjusted = true;
  }
  return out;
}

// A placeholder's own first-level style. (A paragraph's own default run style is not one
// PowerPoint shows, so it is not read.)
const ownStyle = (shape) => (shape ? [find(shape, 'txBody/lstStyle/lvl1pPr/defRPr')] : []);

function describe(shape, context) {
  const { masterPlaceholders, masterRoot, presentation, theme, colorMap } = context;
  const kind = local(shape.name);
  const identity = descendant(shape, 'cNvPr');
  const placeholder = placeholderOf(shape);
  let frame = frameOf(shape);
  const item = { id: identity?.attrs.id ?? null };
  if (placeholder && !FURNITURE.has(placeholder.type)) {
    const from = inheritFrom(masterPlaceholders, placeholder);
    if (!frame && from) {
      frame = frameOf(from.shape);
      if (frame) item.inherited = true;
    }
    const styles = child(masterRoot, 'txStyles');
    const chain = [...ownStyle(shape), ...ownStyle(from?.shape),
      find(styles, `${family(placeholder.type) === 'title' ? 'titleStyle' : 'bodyStyle'}/lvl1pPr/defRPr`),
      find(presentation, 'defaultTextStyle/lvl1pPr/defRPr')];
    const style = textStyle(chain, theme, colorMap);
    const ordered = Object.fromEntries(['size', 'bold', 'font', 'color'].filter((key) => style[key] !== undefined)
      .map((key) => [key, style[key]]));
    return { content: true, item: { id: item.id, type: placeholder.type,
      ...(placeholder.idx !== undefined ? { idx: placeholder.idx } : {}), ...frame,
      ...(item.inherited ? { inherited: true } : {}), ...ordered } };
  }
  return { content: false, item: { ...item, kind, ...(placeholder ? { placeholder: placeholder.type } : {}), ...frame } };
}

const sha256 = (buffer) => createHash('sha256').update(buffer).digest('hex');

/** The template measured, for one variant of a pack's layouts.json. `master` chooses a master
 *  by number or part; otherwise the one most visible slides use. */
export function measureTemplate(buffer, { variant, master } = {}) {
  if (!/^[a-z][a-z0-9-]*$/.test(String(variant ?? ''))) {
    throw new Error('A variant is lower-case letters, digits and hyphens, starting with a letter, such as light or dark.');
  }
  const pkg = openPackage(buffer);
  const presentation = pkg.xml(PRESENTATION);
  const size = child(presentation, 'sldSz');
  if (!size) throw new Error('Its presentation gives no slide size.');
  const slides = slidesOf(pkg);
  const masters = mastersOf(pkg);
  const { master: chosen, by: chosenBy } = chooseMaster(masters, slides, master);
  const masterRoot = pkg.xml(chosen.part);
  const theme = themeOf(pkg, chosen.part);
  const colorMap = child(masterRoot, 'clrMap')?.attrs ?? {};
  const masterPlaceholders = shapesOf(masterRoot).map((shape) => ({ ...placeholderOf(shape), shape }))
    .filter((each) => each.type);
  const context = { masterPlaceholders, masterRoot, presentation, theme, colorMap };
  const masterArtwork = shapesOf(masterRoot).map((shape) => describe(shape, context))
    .filter((each) => !each.content).map((each) => each.item);
  const ids = new Map();
  const layouts = chosen.layouts.map((part, n) => {
    const root = pkg.xml(part);
    const id = `${variant}-layout-${String(n + 1).padStart(3, '0')}`;
    ids.set(part, id);
    const rawName = String(attr(child(root, 'cSld'), 'name') ?? '');
    const first = slides.find((s) => !s.hidden && s.layoutPart === part);
    const layout = { id, name: tidy(rawName), part };
    if (rawName !== layout.name) layout.rawName = rawName;
    if (attr(root, 'type')) layout.type = attr(root, 'type');
    Object.assign(layout, { used: Boolean(first), slide: first?.slide ?? null, renderPage: first?.renderPage ?? null });
    if (no(attr(root, 'showMasterSp'))) layout.showsMasterArtwork = false;
    // A layout may map theme colours its own way (a dark layout in a light template).
    const override = find(root, 'clrMapOvr/overrideClrMapping')?.attrs;
    const here = override ? { ...context, colorMap: override } : context;
    const described = shapesOf(root).map((shape) => describe(shape, here));
    layout.placeholders = described.filter((each) => each.content).map((each) => each.item);
    layout.artwork = described.filter((each) => !each.content).map((each) => each.item);
    return layout;
  });
  return {
    template: `templates/${variant}.pptx`,
    sha256: sha256(buffer),
    canvas: { width: pt(size.attrs.cx), height: pt(size.attrs.cy) },
    master: chosen.part,
    chosenBy,
    masters: masters.map((m) => ({ number: m.number, part: m.part, layouts: m.layouts.length,
      slides: slides.filter((s) => !s.hidden && m.layouts.includes(s.layoutPart)).length })),
    theme,
    masterArtwork,
    layouts,
    slides: slides.map((s) => ({ slide: s.slide, hidden: s.hidden, renderPage: s.renderPage,
      layout: ids.get(s.layoutPart) ?? null })),
  };
}

/** What a person or an assistant adds to a measured layout, kept when the template is measured again. */
export const JUDGEMENT = ['relationship', 'contentRange', 'components', 'searchTerms', 'delivery', 'searchable', 'notes'];

/** How a layout measured afresh finds the one it was before: by name when the name is unique
 *  in both (PowerPoint renumbers layout parts when a template is saved), else by part and name. */
function finder(before, after) {
  const once = (list, name) => list.filter((each) => each.name === name).length === 1;
  return (layout) => (once(before, layout.name) && once(after, layout.name)
    ? before.find((each) => each.name === layout.name)
    : before.find((each) => each.part === layout.part && each.name === layout.name)) ?? null;
}

// What was added to a layout by hand (a preview is drawn again, so it is not counted).
const added = (layout) => JUDGEMENT.filter((key) => layout[key] !== undefined);

/** layouts.json with one variant measured afresh. A layout keeps its judgement fields when the
 *  one it was before is found, and its preview when the template is unchanged. */
export function mergeLayouts(previous, variant, measured) {
  const before = previous?.variants?.[variant];
  const earlier = finder(before?.layouts ?? [], measured.layouts);
  const layouts = measured.layouts.map((layout) => {
    const old = earlier(layout);
    if (!old) return { ...layout };
    const kept = {};
    for (const key of JUDGEMENT) if (old[key] !== undefined) kept[key] = old[key];
    if (old.preview && before.sha256 === measured.sha256) kept.preview = old.preview;
    return { ...layout, ...kept };
  });
  const variants = { ...(previous?.variants ?? {}), [variant]: { ...measured, layouts } };
  return { schema: 1, variants: Object.fromEntries(Object.keys(variants).sort().map((key) => [key, variants[key]])) };
}

/** The layouts that had something added to them before and are no longer found in the
 *  template measured afresh: [{id, name, part, fields}]. */
export function lostLayouts(previous, variant, measured) {
  const before = previous?.variants?.[variant]?.layouts ?? [];
  const now = finder(measured.layouts, before);
  return before.filter((layout) => added(layout).length && !now(layout))
    .map((layout) => ({ id: layout.id, name: layout.name, part: layout.part, fields: added(layout) }));
}
