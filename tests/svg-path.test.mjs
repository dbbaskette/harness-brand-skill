import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  apply, bounds, format, parsePath, parseTransform, transformSegments,
} from '../scripts/lib/svg-path.mjs';

const near = (actual, expected) => assert.ok(Math.abs(actual - expected) < 1e-6, `${actual} is not ${expected}`);

test('absolute and relative lines, with H, V and an implicit line after M', () => {
  assert.equal(format(parsePath('M10 10 L20 10 Z')), 'M10 10 L20 10 Z');
  assert.equal(format(parsePath('m10 10 10 0 v5 h-10z')), 'M10 10 L20 10 L20 15 L10 15 Z');
});

test('a closed subpath returns to its start for the next relative move', () => {
  assert.equal(format(parsePath('M10 10 L20 10 Z m5 5 l1 0')), 'M10 10 L20 10 Z M15 15 L16 15');
});

test('smooth and quadratic curves become cubics', () => {
  assert.equal(format(parsePath('M0 0 C0 10 10 10 10 0 S20 -10 20 0')),
    'M0 0 C0 10 10 10 10 0 C10 -10 20 -10 20 0');
  assert.equal(format(parsePath('M0 0 Q15 30 30 0')), 'M0 0 C10 20 20 20 30 0');
  assert.equal(format(parsePath('M0 0 Q15 30 30 0 T60 0')), 'M0 0 C10 20 20 20 30 0 C40 -20 50 -20 60 0');
});

test('an arc becomes cubics that pass through the arc', () => {
  const segs = parsePath('M0 0 A10 10 0 0 1 20 0');
  assert.equal(segs.length, 3);
  const [x, y] = segs[1].pts[2];
  near(x, 10);
  near(y, -10);
  assert.deepEqual(segs[2].pts[2], [20, 0]);
});

test('arc flags may be written without spaces', () => {
  assert.equal(format(parsePath('M0 0a10 10 0 0120 0')), format(parsePath('M0 0 A10 10 0 0 1 20 0')));
});

test('bad path data is refused', () => {
  assert.throws(() => parsePath('10 10'), /start with a command/);
  assert.throws(() => parsePath('M10'), /no number/);
});

test('transforms compose left to right, as SVG writes them', () => {
  const m = parseTransform('translate(10 0) scale(2)');
  assert.deepEqual(apply(m, [1, 1]), [12, 2]);
  const r = parseTransform('rotate(90 10 10)');
  const [x, y] = apply(r, [20, 10]);
  near(x, 10);
  near(y, 20);
  assert.deepEqual(apply(parseTransform(''), [3, 4]), [3, 4]);
  assert.throws(() => parseTransform('wobble(3)'), /wobble/);
});

test('bounds and transformed segments', () => {
  const segs = transformSegments(parsePath('M0 0 L10 0 L10 5 Z'), parseTransform('translate(5 5)'));
  assert.deepEqual(bounds(segs), [5, 5, 15, 10]);
  assert.deepEqual(bounds([]), [0, 0, 0, 0]);
});

test('numbers are written to two places, without -0', () => {
  assert.equal(format(parsePath('M0.004 -0.001 L1.23456 2')), 'M0 0 L1.23 2');
});

// The point at parameter t of a cubic whose start is p0, returned as [x, y].
const cubicAt = ([p0, p1, p2, p3], t) => {
  const u = 1 - t;
  return [0, 1].map((k) => u * u * u * p0[k] + 3 * u * u * t * p1[k] + 3 * u * t * t * p2[k] + t * t * t * p3[k]);
};

test('an arc whose chord is shorter than its diameter takes the small or the large side', () => {
  const small = parsePath('M0 0 A10 10 0 0 1 14 0');
  assert.equal(small.length, 2);
  assert.equal(small[1].op, 'C');
  assert.deepEqual(small[1].pts[2], [14, 0]);
  const [, midY] = cubicAt([[0, 0], ...small[1].pts], 0.5);
  assert.ok(midY > -3.1 && midY < -2.7, `${midY} is not about -2.86`);

  const large = parsePath('M0 0 A10 10 0 1 1 14 0');
  assert.ok(large.length > 2, 'the large arc takes more than one cubic');
  assert.deepEqual(large.at(-1).pts[2], [14, 0]);
  const lowest = Math.min(...large.flatMap((seg) => seg.pts ?? []).map(([, y]) => y));
  assert.ok(lowest < -15, `${lowest} is not below -15`);
});

test('radii too small for the chord are scaled up until the arc fits it', () => {
  const segs = parsePath('M0 0 A1 1 0 0 1 20 0');
  assert.deepEqual(segs.at(-1).pts[2], [20, 0]);
  near(segs[1].pts[2][0], 10);
  near(segs[1].pts[2][1], -10);
});

test('a relative arc is measured from the current point', () => {
  assert.deepEqual(parsePath('M10 10 a10 10 0 0 1 20 0').at(-1).pts[2], [30, 10]);
});

test('a rotated ellipse ends at its end point', () => {
  const segs = parsePath('M0 0 A20 10 30 0 1 30 10');
  assert.ok(segs.length >= 2, 'the arc is at least one cubic');
  assert.deepEqual(segs.at(-1).pts[2], [30, 10]);
});

test('S after Q does not reflect the quadratic control point', () => {
  assert.deepEqual(parsePath('M0 0 Q5 10 10 0 S20 -10 20 0').at(-1).pts[0], [10, 0]);
});

test('T after C does not reflect the cubic control point, so the curve is a straight line', () => {
  const [c1, c2, end] = parsePath('M0 0 C0 10 10 10 10 0 T20 0').at(-1).pts;
  assert.deepEqual(c1, [10, 0]);
  near(c2[0], 40 / 3);
  assert.equal(c2[1], 0);
  assert.deepEqual(end, [20, 0]);
});

test('an s after Z does not reflect the curve before the close', () => {
  assert.deepEqual(parsePath('M0 0 C0 10 10 10 10 0 Z s5 5 10 0').at(-1).pts[0], [0, 0]);
});

test('a draw command after Z without an M starts a new subpath at the last start', () => {
  assert.equal(format(parsePath('M0 0 L10 0 Z L5 5')), 'M0 0 L10 0 Z M0 0 L5 5');
});

test('bounds cover the drawn curve, not its control points', () => {
  const [x0, y0, x1, y1] = bounds(parsePath('M0 0 C0 10 10 10 10 0'));
  near(x0, 0);
  near(y0, 0);
  near(x1, 10);
  near(y1, 7.5);
});

test('bounds of a very long path do not overflow the call stack', () => {
  const d = `M0 0 ${Array.from({ length: 150000 }, (_, i) => `L${i + 1} ${i % 7}`).join(' ')}`;
  assert.deepEqual(bounds(parsePath(d)), [0, 0, 150000, 6]);
});

test('numbers too large to draw are refused', () => {
  assert.throws(() => parsePath('M0 0 L1e999 0'), /too large/);
});

test('transform arguments may run together with signs and points', () => {
  assert.deepEqual(apply(parseTransform('translate(10-5)'), [0, 0]), [10, -5]);
  assert.deepEqual(apply(parseTransform('scale(-.5-.5)'), [2, 4]), [-1, -2]);
});

test('transforms with the wrong number of arguments, or leftover text, are refused', () => {
  assert.throws(() => parseTransform('rotate(45 3)'), /cannot be read/);
  assert.throws(() => parseTransform('translate(1 2 3)'), /cannot be read/);
  assert.throws(() => parseTransform('scale(2) translate(1'), /cannot be read/);
  assert.throws(() => parseTransform('translate(1) junk scale(2)'), /cannot be read/);
});
