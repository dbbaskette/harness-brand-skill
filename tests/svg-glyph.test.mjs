import { test } from 'node:test';
import assert from 'node:assert/strict';
import { convertSvg } from '../scripts/lib/icons/svg-glyph.mjs';

const svg = (box, body) => `<svg xmlns="http://www.w3.org/2000/svg" viewBox="${box}">${body}</svg>`;
const RECT = 'M50 50 L60 50 L60 60 L50 60 Z';

test('a plain drawing is scaled from its view box into the 0 to 100 box', () => {
  const glyph = convertSvg(svg('0 0 50 50', '<path d="M10 10 H40 V40 H10 Z"/>'));
  assert.deepEqual(glyph.paths, ['M20 20 L80 20 L80 80 L20 80 Z']);
  assert.deepEqual(glyph.bounds, [20, 20, 80, 80]);
});

test('fill places the view box in a centred share of the box', () => {
  const glyph = convertSvg(svg('0 0 50 50', '<path d="M10 10 H40 V40 H10 Z"/>'), { fill: 0.5 });
  assert.deepEqual(glyph.paths, ['M35 35 L65 35 L65 65 L35 65 Z']);
});

test('a container circle under the glyph is dropped (VMware by Broadcom icons)', () => {
  const glyph = convertSvg(svg('0 0 100 100',
    '<circle cx="50" cy="50" r="50" fill="#005c8a"/><rect x="30" y="30" width="40" height="40" fill="#fff"/>'));
  assert.deepEqual(glyph.paths, ['M30 30 L70 30 L70 70 L30 70 Z']);
});

test('a container drawn twice is dropped too', () => {
  const circle = '<circle cx="50" cy="50" r="50" fill="#005c8a"/>';
  const glyph = convertSvg(svg('0 0 100 100', `${circle}${circle}<rect x="30" y="30" width="40" height="40" fill="#fff"/>`));
  assert.deepEqual(glyph.paths, ['M30 30 L70 30 L70 70 L30 70 Z']);
});

test('a container drawn twice in two colours is dropped too', () => {
  const glyph = convertSvg(svg('0 0 100 100', '<circle cx="50" cy="50" r="50" fill="#005c8a"/>'
    + '<circle cx="50" cy="50" r="49.9" fill="#005b84"/><rect x="30" y="30" width="40" height="40" fill="#fff"/>'));
  assert.deepEqual(glyph.paths, ['M30 30 L70 30 L70 70 L30 70 Z']);
});

test('a fill drawn through a mask takes the mask as the glyph (Tanzu Division icons)', () => {
  const glyph = convertSvg(svg('0 0 100 100',
    '<mask id="m"><path d="M10 10 H20 V20 H10 Z" fill="#fff"/></mask>'
    + '<rect width="100" height="100" fill="#005c8a" mask="url(#m)"/>'));
  assert.deepEqual(glyph.paths, ['M10 10 L20 10 L20 20 L10 20 Z']);
});

test('group transforms are applied', () => {
  const glyph = convertSvg(svg('0 0 100 100', '<g transform="translate(10 0)"><rect width="10" height="10"/></g>'));
  assert.deepEqual(glyph.paths, ['M10 0 L20 0 L20 10 L10 10 Z']);
});

test('one shape alone is kept even when it fills the box', () => {
  const glyph = convertSvg(svg('0 0 100 100', '<rect width="100" height="100"/>'));
  assert.deepEqual(glyph.paths, ['M0 0 L100 0 L100 100 L0 100 Z']);
});

test('a frame that fills a tight view box is kept with the rest of its glyph', () => {
  const glyph = convertSvg(svg('0 0 100 100', '<path d="M0 0H100V100H0Z M30 30V70H70V30Z"/><circle cx="50" cy="50" r="5"/>'));
  assert.equal(glyph.paths.length, 2);
});

test('overlapping shapes stay separate paths, so they add up instead of cancelling', () => {
  const glyph = convertSvg(svg('0 0 100 100',
    '<rect x="10" y="10" width="40" height="40"/><rect x="30" y="30" width="40" height="40"/>'));
  assert.equal(glyph.paths.length, 2);
  assert.deepEqual(glyph.bounds, [10, 10, 70, 70]);
});

test('an exact repeat of a shape is drawn once', () => {
  const glyph = convertSvg(svg('0 0 100 100',
    '<rect x="10" y="10" width="20" height="20"/><rect x="10" y="10" width="20" height="20"/>'));
  assert.deepEqual(glyph.paths, ['M10 10 L30 10 L30 30 L10 30 Z']);
});

test('hidden and clear shapes are left out', () => {
  const hidden = [
    '<g display="none"><rect width="9" height="9"/></g>',
    '<rect width="9" height="9" style="display:none"/>',
    '<g visibility="hidden"><rect width="9" height="9"/></g>',
    '<g opacity="0"><rect width="9" height="9"/></g>',
    '<g fill-opacity="0"><rect width="9" height="9"/></g>',
    '<rect width="9" height="9" fill="transparent"/>',
    '<rect width="9" height="9" fill="rgba(0, 0, 0, 0)"/>',
    '<rect width="9" height="9" fill="#ffffff00"/>',
    '<rect width="9" height="9" fill-opacity="0%"/>',
  ];
  for (const body of hidden) {
    const glyph = convertSvg(svg('0 0 100 100', `${body}<rect x="50" y="50" width="10" height="10"/>`));
    assert.deepEqual(glyph.paths, [RECT], body);
  }
});

test('circles, polygons and rounded rectangles are outlines too', () => {
  assert.ok(convertSvg(svg('0 0 100 100', '<circle cx="50" cy="50" r="10"/>')).paths[0].startsWith('M40 50 C'));
  assert.deepEqual(convertSvg(svg('0 0 100 100', '<polygon points="0,0 10,0 10,10"/>')).paths, ['M0 0 L10 0 L10 10 Z']);
  assert.ok(convertSvg(svg('0 0 100 100', '<rect width="20" height="20" rx="4"/>')).paths[0].includes('C'));
});

test('a mask that cuts holes with black is refused', () => {
  const glyph = convertSvg(svg('0 0 100 100',
    '<mask id="m"><rect width="100" height="100" fill="#fff"/><rect x="40" y="40" width="20" height="20" fill="#000"/></mask>'
    + '<rect width="100" height="100" fill="#005c8a" mask="url(#m)"/>'));
  assert.match(glyph.skip, /black/);
});

test('what is not read is refused rather than drawn wrongly', () => {
  for (const body of [
    '<defs><path id="p" d="M0 0 H5 V5 Z"/></defs><use href="#p"/><rect width="2" height="2"/>',
    '<style>.a{fill:none}</style><rect class="a" width="2" height="2"/>',
    '<rect width="2" height="2" clip-path="url(#c)"/>',
    '<svg x="50" y="50" width="20" height="20" viewBox="0 0 10 10"><rect width="10" height="10"/></svg>',
  ]) {
    assert.match(convertSvg(svg('0 0 10 10', body)).skip, /not read/, body);
  }
  assert.match(convertSvg('<svg width="100%" height="100%"><path d="M0 0 H5 V5 Z"/></svg>').skip, /view box/);
});

test('what cannot be one glyph says why', () => {
  assert.match(convertSvg(svg('0 0 10 10', '<path d="M0 0 L10 10" fill="none" stroke="#000"/>')).skip, /lines/);
  assert.match(convertSvg(svg('0 0 10 10', '')).skip, /draws nothing/);
  assert.match(convertSvg('<html/>').skip, /not an SVG/);
  assert.match(convertSvg('<svg><path d="M0 0"/></svg>').skip, /view box/);
  assert.match(convertSvg('<svg viewBox="0 0 10 10"><path d="Q"/></svg>').skip, /number/);
});
