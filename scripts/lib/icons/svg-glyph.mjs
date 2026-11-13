// One SVG drawing as one single-colour glyph: a list of paths in the 0 to 100 box, each
// filled even-odd on its own and all painted together, so overlapping shapes add up.
import { all, parseXml, walk } from '../xml.mjs';
import {
  IDENTITY, bounds, format, multiply, parsePath, parseTransform, round, transformSegments,
} from '../svg-path.mjs';

const NOT_DRAWN = new Set(['defs', 'mask', 'clipPath', 'title', 'desc', 'metadata', 'style',
  'symbol', 'linearGradient', 'radialGradient', 'pattern', 'filter']);
const GROUPS = new Set(['g', 'svg', 'a']);
const CONTAINER = 0.95;   // a shape this much of the view box wide and high may be a container
const UNREAD = 'it uses <use>, a clip path, a style sheet or a drawing inside another, which are not read';

function style(node, name) {
  const inline = new RegExp(`(?:^|;)\\s*${name}\\s*:\\s*([^;]+)`).exec(node.attrs.style ?? '');
  const value = inline ? inline[1] : node.attrs[name];
  return value === undefined ? undefined : String(value).trim();
}

const amount = (text) => {
  const value = String(text).trim();
  return value.endsWith('%') ? parseFloat(value) / 100 : parseFloat(value);
};
const plain = (colour) => String(colour ?? '').trim().toLowerCase().replace(/\s+/g, '');

/** Whether a fill paints nothing: none, transparent, or a colour with no alpha. */
function clear(fill) {
  const value = plain(fill);
  if (value === 'none' || value === 'transparent') return true;
  if (/^#[0-9a-f]{8}$/.test(value)) return value.endsWith('00');
  if (/^#[0-9a-f]{4}$/.test(value)) return value.endsWith('0');
  const alpha = /^(?:rgba|hsla)\(([^)]*)\)$/.exec(value);
  if (alpha) {
    const parts = alpha[1].split(/[,/]/);
    return parts.length === 4 && amount(parts[3]) === 0;
  }
  return false;
}

const black = (fill) => /^(#000|#000000|black|rgb\(0%?,0%?,0%?\))$/.test(plain(fill));

function viewBox(root) {
  const v = String(root.attrs.viewBox ?? '').trim().split(/[\s,]+/).map(Number);
  if (v.length === 4 && v.every(Number.isFinite) && v[2] > 0 && v[3] > 0) {
    return { x: v[0], y: v[1], w: v[2], h: v[3] };
  }
  const pixels = (text) => (/^\s*(\d+\.?\d*|\.\d+)\s*(px)?\s*$/.test(String(text ?? '')) ? parseFloat(text) : NaN);
  const w = pixels(root.attrs.width);
  const h = pixels(root.attrs.height);
  return w > 0 && h > 0 ? { x: 0, y: 0, w, h } : null;
}

const measure = (node, name) => {
  const v = parseFloat(node.attrs[name]);
  return Number.isFinite(v) ? v : 0;
};

const ellipse = (cx, cy, rx, ry) => `M${cx - rx} ${cy} A${rx} ${ry} 0 1 0 ${cx + rx} ${cy} `
  + `A${rx} ${ry} 0 1 0 ${cx - rx} ${cy} Z`;

/** The outline of a drawn element as path data, or null for one that draws nothing. */
function outline(node) {
  switch (node.name) {
    case 'path':
      return node.attrs.d ?? null;
    case 'rect': {
      const x = measure(node, 'x'); const y = measure(node, 'y');
      const w = measure(node, 'width'); const h = measure(node, 'height');
      if (w <= 0 || h <= 0) return null;
      const rxGiven = parseFloat(node.attrs.rx);
      const ryGiven = parseFloat(node.attrs.ry);
      let rx = Number.isFinite(rxGiven) ? rxGiven : (Number.isFinite(ryGiven) ? ryGiven : 0);
      let ry = Number.isFinite(ryGiven) ? ryGiven : rx;
      rx = Math.min(rx, w / 2);
      ry = Math.min(ry, h / 2);
      if (!rx || !ry) return `M${x} ${y} H${x + w} V${y + h} H${x} Z`;
      return `M${x + rx} ${y} H${x + w - rx} A${rx} ${ry} 0 0 1 ${x + w} ${y + ry} `
        + `V${y + h - ry} A${rx} ${ry} 0 0 1 ${x + w - rx} ${y + h} H${x + rx} `
        + `A${rx} ${ry} 0 0 1 ${x} ${y + h - ry} V${y + ry} A${rx} ${ry} 0 0 1 ${x + rx} ${y} Z`;
    }
    case 'circle': {
      const r = measure(node, 'r');
      return r > 0 ? ellipse(measure(node, 'cx'), measure(node, 'cy'), r, r) : null;
    }
    case 'ellipse': {
      const rx = measure(node, 'rx'); const ry = measure(node, 'ry');
      return rx > 0 && ry > 0 ? ellipse(measure(node, 'cx'), measure(node, 'cy'), rx, ry) : null;
    }
    case 'polygon':
    case 'polyline': {
      const v = String(node.attrs.points ?? '').trim().split(/[\s,]+/).filter(Boolean).map(Number);
      if (v.length < 4 || v.some((n) => !Number.isFinite(n))) return null;
      const pairs = [];
      for (let i = 0; i + 1 < v.length; i += 2) pairs.push(`${v[i]} ${v[i + 1]}`);
      return `M${pairs.join(' L')} Z`;
    }
    default:
      return null;
  }
}

// `paint` carries what children inherit: fill, stroke, fillOpacity, visibility, and hidden
// (an ancestor with opacity 0).
function collect(node, matrix, paint, masks, out, inMask) {
  for (const child of node.children) {
    if (NOT_DRAWN.has(child.name) || style(child, 'display') === 'none') continue;
    const here = multiply(matrix, parseTransform(child.attrs.transform));
    const opacity = style(child, 'opacity');
    const inherited = {
      fill: style(child, 'fill') ?? paint.fill,
      stroke: style(child, 'stroke') ?? paint.stroke,
      fillOpacity: style(child, 'fill-opacity') ?? paint.fillOpacity,
      visibility: style(child, 'visibility') ?? paint.visibility,
      hidden: paint.hidden || (opacity !== undefined && amount(opacity) === 0),
    };
    const mask = /url\(\s*#([^)\s]+)\s*\)/.exec(style(child, 'mask') ?? '');
    if (mask && masks.has(mask[1])) {
      if (!inherited.hidden && inherited.visibility !== 'hidden') collect(masks.get(mask[1]), here, {}, masks, out, true);
      continue;
    }
    if (GROUPS.has(child.name)) {
      collect(child, here, inherited, masks, out, inMask);
      continue;
    }
    const d = outline(child);
    if (d === null) continue;
    const fill = inherited.fill ?? '#000000';
    const shown = !inherited.hidden && inherited.visibility !== 'hidden' && inherited.visibility !== 'collapse';
    const filled = !clear(fill) && !(inherited.fillOpacity !== undefined && amount(inherited.fillOpacity) === 0);
    out.push({
      segs: transformSegments(parsePath(d), here),
      painted: shown && filled,
      fill: plain(fill),
      inMask,
      stroked: shown && Boolean(inherited.stroke && inherited.stroke !== 'none'),
    });
  }
}

/** {paths, bounds} for the drawing, or {skip: why it cannot be one glyph}. `fill` is the
 *  share of the 0 to 100 box the drawing's view box fills, centred. */
export function convertSvg(text, { fill = 1 } = {}) {
  let root;
  try {
    root = parseXml(text);
  } catch (error) {
    return { skip: `it is not readable SVG (${error.message})` };
  }
  if (root.name !== 'svg') return { skip: 'it is not an SVG drawing' };
  const clipped = [...walk(root)].some((node) => {
    const clip = style(node, 'clip-path');
    return clip !== undefined && clip !== 'none';
  });
  if (all(root, 'use').length || all(root, 'style').length || all(root, 'svg').length > 1 || clipped) {
    return { skip: UNREAD };
  }
  const box = viewBox(root);
  if (!box) return { skip: 'it has no view box or size in pixels' };
  const masks = new Map(all(root, 'mask').filter((m) => m.attrs.id).map((m) => [m.attrs.id, m]));
  const shapes = [];
  try {
    collect(root, parseTransform(root.attrs.transform), {}, masks, shapes, false);
  } catch (error) {
    return { skip: `its drawing cannot be read: ${error.message}` };
  }
  if (shapes.some((shape) => shape.painted && shape.inMask && black(shape.fill))) {
    return { skip: 'its mask cuts holes with black shapes, which a glyph cannot hold' };
  }
  const painted = shapes.filter((shape) => shape.painted);
  if (!painted.length) {
    return { skip: shapes.some((shape) => shape.stroked)
      ? 'it is drawn with lines, not filled shapes' : 'it draws nothing' };
  }
  // An exact repeat of a shape adds nothing.
  const unique = [...new Map(painted.map((shape) => [format(shape.segs), shape])).values()];
  const covers = (shape) => {
    const [x0, y0, x1, y1] = bounds(shape.segs);
    return x1 - x0 >= CONTAINER * box.w && y1 - y0 >= CONTAINER * box.h;
  };
  // Containers are shapes outside any mask that cover the view box in colours the rest of
  // the drawing does not use. They are dropped when something else is left to draw.
  const container = (shape) => !shape.inMask && covers(shape);
  const others = unique.filter((shape) => !container(shape));
  const used = new Set(others.map((shape) => shape.fill));
  const glyph = others.length ? unique.filter((shape) => !container(shape) || used.has(shape.fill)) : unique;
  const scale = (100 * fill) / Math.max(box.w, box.h);
  const fit = [scale, 0, 0, scale, (100 - box.w * scale) / 2 - box.x * scale,
    (100 - box.h * scale) / 2 - box.y * scale];
  const placed = glyph.map((shape) => transformSegments(shape.segs, fit));
  return { paths: placed.map(format), bounds: bounds(placed.flat()).map(round) };
}
