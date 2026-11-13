// SVG path data as absolute segments: {op: 'M'|'L'|'C', pts: [[x, y], ...]} or {op: 'Z'}.
// Quadratic curves and arcs become cubics, so every path needs only four operations.

const NUMBER = /^[-+]?(?:\d+\.?\d*|\.\d+)(?:[eE][-+]?\d+)?/;

export function parsePath(d) {
  const out = [];
  let i = 0;
  let command = null;
  let x = 0; let y = 0; let startX = 0; let startY = 0;
  let lastCubic = null; let lastQuad = null;
  const skip = () => { while (i < d.length && /[\s,]/.test(d[i])) i += 1; };
  const number = () => {
    skip();
    const match = NUMBER.exec(d.slice(i));
    if (!match) throw new Error(`The path has no number at ${i}.`);
    i += match[0].length;
    const value = Number(match[0]);
    if (!Number.isFinite(value)) throw new Error(`The path has a number too large to draw at ${i}.`);
    return value;
  };
  const flag = () => {
    skip();
    const ch = d[i];
    if (ch !== '0' && ch !== '1') throw new Error(`The path has no arc flag at ${i}.`);
    i += 1;
    return ch === '1';
  };
  for (;;) {
    skip();
    if (i >= d.length) break;
    if (/[A-Za-z]/.test(d[i])) { command = d[i]; i += 1; }
    else if (!command) throw new Error('The path does not start with a command.');
    const relative = command === command.toLowerCase();
    const op = command.toUpperCase();
    const ox = relative ? x : 0;
    const oy = relative ? y : 0;
    const before = out.length;
    switch (op) {
      case 'Z':
        out.push({ op: 'Z' });
        x = startX; y = startY; lastCubic = null; lastQuad = null; command = null;
        break;
      case 'M':
        x = ox + number(); y = oy + number();
        out.push({ op: 'M', pts: [[x, y]] });
        startX = x; startY = y; lastCubic = null; lastQuad = null;
        command = relative ? 'l' : 'L';
        break;
      case 'L':
        x = ox + number(); y = oy + number();
        out.push({ op: 'L', pts: [[x, y]] });
        lastCubic = null; lastQuad = null;
        break;
      case 'H':
        x = ox + number();
        out.push({ op: 'L', pts: [[x, y]] });
        lastCubic = null; lastQuad = null;
        break;
      case 'V':
        y = oy + number();
        out.push({ op: 'L', pts: [[x, y]] });
        lastCubic = null; lastQuad = null;
        break;
      case 'C': {
        const one = [ox + number(), oy + number()];
        const two = [ox + number(), oy + number()];
        x = ox + number(); y = oy + number();
        out.push({ op: 'C', pts: [one, two, [x, y]] });
        lastCubic = two; lastQuad = null;
        break;
      }
      case 'S': {
        const one = lastCubic ? [2 * x - lastCubic[0], 2 * y - lastCubic[1]] : [x, y];
        const two = [ox + number(), oy + number()];
        x = ox + number(); y = oy + number();
        out.push({ op: 'C', pts: [one, two, [x, y]] });
        lastCubic = two; lastQuad = null;
        break;
      }
      case 'Q': {
        const control = [ox + number(), oy + number()];
        const end = [ox + number(), oy + number()];
        out.push(quadratic([x, y], control, end));
        [x, y] = end; lastQuad = control; lastCubic = null;
        break;
      }
      case 'T': {
        const control = lastQuad ? [2 * x - lastQuad[0], 2 * y - lastQuad[1]] : [x, y];
        const end = [ox + number(), oy + number()];
        out.push(quadratic([x, y], control, end));
        [x, y] = end; lastQuad = control; lastCubic = null;
        break;
      }
      case 'A': {
        const rx = number(); const ry = number(); const angle = number();
        const large = flag(); const sweep = flag();
        const endX = ox + number(); const endY = oy + number();
        out.push(...arc(x, y, rx, ry, angle, large, sweep, endX, endY));
        x = endX; y = endY; lastCubic = null; lastQuad = null;
        break;
      }
      default:
        throw new Error(`The path has an unknown command ${command}.`);
    }
    // A segment drawn straight after a close starts a new subpath at the close's start.
    if (out.length > before && out[before].op !== 'M' && out[before].op !== 'Z' && out[before - 1]?.op === 'Z') {
      out.splice(before, 0, { op: 'M', pts: [[startX, startY]] });
    }
  }
  return out;
}

function quadratic(start, control, end) {
  return {
    op: 'C',
    pts: [
      [start[0] + (2 / 3) * (control[0] - start[0]), start[1] + (2 / 3) * (control[1] - start[1])],
      [end[0] + (2 / 3) * (control[0] - end[0]), end[1] + (2 / 3) * (control[1] - end[1])],
      end,
    ],
  };
}

// An elliptical arc as cubics, following the SVG specification's centre parameterisation.
function arc(x1, y1, rxIn, ryIn, angle, large, sweep, x2, y2) {
  if (x1 === x2 && y1 === y2) return [];
  let rx = Math.abs(rxIn);
  let ry = Math.abs(ryIn);
  if (!rx || !ry) return [{ op: 'L', pts: [[x2, y2]] }];
  const phi = (angle * Math.PI) / 180;
  const cos = Math.cos(phi);
  const sin = Math.sin(phi);
  const dx = (x1 - x2) / 2;
  const dy = (y1 - y2) / 2;
  const xp = cos * dx + sin * dy;
  const yp = -sin * dx + cos * dy;
  const lambda = (xp * xp) / (rx * rx) + (yp * yp) / (ry * ry);
  if (lambda > 1) { rx *= Math.sqrt(lambda); ry *= Math.sqrt(lambda); }
  const top = rx * rx * ry * ry - rx * rx * yp * yp - ry * ry * xp * xp;
  const bottom = rx * rx * yp * yp + ry * ry * xp * xp;
  let k = Math.sqrt(Math.max(0, top / bottom));
  if (large === sweep) k = -k;
  const cxp = (k * rx * yp) / ry;
  const cyp = (-k * ry * xp) / rx;
  const cx = cos * cxp - sin * cyp + (x1 + x2) / 2;
  const cy = sin * cxp + cos * cyp + (y1 + y2) / 2;
  const between = (ux, uy, vx, vy) => Math.atan2(ux * vy - uy * vx, ux * vx + uy * vy);
  const start = between(1, 0, (xp - cxp) / rx, (yp - cyp) / ry);
  let delta = between((xp - cxp) / rx, (yp - cyp) / ry, (-xp - cxp) / rx, (-yp - cyp) / ry);
  if (!sweep && delta > 0) delta -= 2 * Math.PI;
  else if (sweep && delta < 0) delta += 2 * Math.PI;
  const pieces = Math.max(1, Math.ceil(Math.abs(delta) / (Math.PI / 2)));
  const step = delta / pieces;
  const alpha = (4 / 3) * Math.tan(step / 4);
  const point = (t) => [cx + rx * Math.cos(t) * cos - ry * Math.sin(t) * sin,
    cy + rx * Math.cos(t) * sin + ry * Math.sin(t) * cos];
  const tangent = (t) => [-rx * Math.sin(t) * cos - ry * Math.cos(t) * sin,
    -rx * Math.sin(t) * sin + ry * Math.cos(t) * cos];
  const out = [];
  for (let n = 0; n < pieces; n += 1) {
    const a = start + n * step;
    const b = a + step;
    const [p0, p3, d0, d3] = [point(a), point(b), tangent(a), tangent(b)];
    out.push({ op: 'C', pts: [[p0[0] + alpha * d0[0], p0[1] + alpha * d0[1]],
      [p3[0] - alpha * d3[0], p3[1] - alpha * d3[1]], p3] });
  }
  out[out.length - 1].pts[2] = [x2, y2];
  return out;
}

// A transform is [a, b, c, d, e, f]: x' = a x + c y + e, y' = b x + d y + f.
export const IDENTITY = [1, 0, 0, 1, 0, 0];

/** `outer` applied after `inner`. */
export function multiply(outer, inner) {
  const [a, b, c, d, e, f] = outer;
  const [A, B, C, D, E, F] = inner;
  return [a * A + c * B, b * A + d * B, a * C + c * D, b * C + d * D, a * E + c * F + e, b * E + d * F + f];
}

const ARGUMENT_COUNTS = {
  matrix: [6], translate: [1, 2], scale: [1, 2], rotate: [1, 3], skewX: [1], skewY: [1],
};

// The numbers in transform arguments, read as path data reads them, or null if other text is there.
function numbersIn(text) {
  const out = [];
  let rest = text.replace(/^[\s,]+/, '');
  while (rest) {
    const match = NUMBER.exec(rest);
    if (!match) return null;
    out.push(Number(match[0]));
    rest = rest.slice(match[0].length).replace(/^[\s,]+/, '');
  }
  return out;
}

export function parseTransform(text) {
  const source = String(text ?? '');
  let matrix = IDENTITY;
  for (const [, name, args] of source.matchAll(/([A-Za-z]+)\s*\(([^)]*)\)/g)) {
    if (!Object.hasOwn(ARGUMENT_COUNTS, name)) throw new Error(`The transform ${name} is not known.`);
    const v = numbersIn(args);
    if (!v || !ARGUMENT_COUNTS[name].includes(v.length)) {
      throw new Error(`The transform ${name}(${args}) cannot be read.`);
    }
    let step;
    switch (name) {
      case 'matrix': step = v; break;
      case 'translate': step = [1, 0, 0, 1, v[0], v[1] ?? 0]; break;
      case 'scale': step = [v[0], 0, 0, v[1] ?? v[0], 0, 0]; break;
      case 'rotate': {
        const r = (v[0] * Math.PI) / 180;
        step = [Math.cos(r), Math.sin(r), -Math.sin(r), Math.cos(r), 0, 0];
        if (v.length === 3) {
          step = multiply(multiply([1, 0, 0, 1, v[1], v[2]], step), [1, 0, 0, 1, -v[1], -v[2]]);
        }
        break;
      }
      case 'skewX': step = [1, 0, Math.tan((v[0] * Math.PI) / 180), 1, 0, 0]; break;
      case 'skewY': step = [1, Math.tan((v[0] * Math.PI) / 180), 0, 1, 0, 0]; break;
      default: throw new Error(`The transform ${name} is not known.`);
    }
    if (step.length !== 6 || step.some((n) => !Number.isFinite(n))) {
      throw new Error(`The transform ${name}(${args}) cannot be read.`);
    }
    matrix = multiply(matrix, step);
  }
  if (source.replace(/([A-Za-z]+)\s*\(([^)]*)\)/g, '').replace(/[\s,]/g, '')) {
    throw new Error(`The transform ${source} cannot be read.`);
  }
  return matrix;
}

export const apply = (m, [x, y]) => [m[0] * x + m[2] * y + m[4], m[1] * x + m[3] * y + m[5]];

export const transformSegments = (segs, m) => segs.map((seg) => (seg.op === 'Z'
  ? seg : { op: seg.op, pts: seg.pts.map((p) => apply(m, p)) }));

// One coordinate of a cubic at parameter t.
const cubicValue = (p0, p1, p2, p3, t) => {
  const u = 1 - t;
  return u * u * u * p0 + 3 * u * u * t * p1 + 3 * u * t * t * p2 + t * t * t * p3;
};

// The parameters strictly inside (0, 1) where one coordinate of a cubic has a zero derivative.
function cubicTurns(p0, p1, p2, p3) {
  const a = -p0 + 3 * p1 - 3 * p2 + p3;
  const b = 2 * (p0 - 2 * p1 + p2);
  const c = p1 - p0;
  let roots;
  if (Math.abs(a) < 1e-12) roots = b === 0 ? [] : [-c / b];
  else {
    const disc = b * b - 4 * a * c;
    roots = disc < 0 ? [] : [(-b + Math.sqrt(disc)) / (2 * a), (-b - Math.sqrt(disc)) / (2 * a)];
  }
  return roots.filter((t) => t > 0 && t < 1);
}

/** [x0, y0, x1, y1] around the drawn path. */
export function bounds(segs) {
  let x0 = Infinity; let y0 = Infinity; let x1 = -Infinity; let y1 = -Infinity;
  const add = ([x, y]) => {
    if (x < x0) x0 = x;
    if (x > x1) x1 = x;
    if (y < y0) y0 = y;
    if (y > y1) y1 = y;
  };
  let current = [0, 0];
  let start = [0, 0];
  for (const seg of segs) {
    if (seg.op === 'Z') {
      current = start;
    } else if (seg.op === 'M') {
      current = seg.pts[0];
      start = current;
      add(current);
    } else if (seg.op === 'L') {
      add(current);
      current = seg.pts[0];
      add(current);
    } else {
      const [p1, p2, p3] = seg.pts;
      add(current);
      add(p3);
      const turns = [...cubicTurns(current[0], p1[0], p2[0], p3[0]), ...cubicTurns(current[1], p1[1], p2[1], p3[1])];
      for (const t of turns) {
        add([cubicValue(current[0], p1[0], p2[0], p3[0], t), cubicValue(current[1], p1[1], p2[1], p3[1], t)]);
      }
      current = p3;
    }
  }
  return x0 === Infinity ? [0, 0, 0, 0] : [x0, y0, x1, y1];
}

export const round = (n) => {
  const v = Math.round(n * 100) / 100;
  return v === 0 ? 0 : v;
};

export const format = (segs) => segs.map((seg) => (seg.op === 'Z' ? 'Z'
  : seg.op + seg.pts.map(([x, y]) => `${round(x)} ${round(y)}`).join(' '))).join(' ');
