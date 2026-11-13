import { test } from 'node:test';
import assert from 'node:assert/strict';
import { contactSheet } from '../scripts/lib/icons/contact-sheet.mjs';
import { parseXml, all } from '../scripts/lib/xml.mjs';

test('every glyph is drawn with its label, and the sheet is valid SVG', () => {
  const sheet = contactSheet({ name: 'Test & co', kind: 'glyph' }, [
    { slug: 'a', name: 'Alpha <1>', category: 'C', bounds: [0, 0, 10, 10], paths: ['M0 0 L10 0 L10 10 Z'] },
    { slug: 'b', name: 'Beta', category: 'C', bounds: [0, 0, 10, 10], paths: ['M0 0 L5 0 L5 5 Z'] },
  ], new Map());
  const root = parseXml(sheet);
  assert.equal(root.name, 'svg');
  assert.equal(all(root, 'path').length, 2);
  assert.ok(sheet.includes('Alpha &lt;1&gt;'));
  assert.ok(sheet.includes('Test &amp; co: 2 icons'));
});

test('a picture is embedded as an image', () => {
  const sheet = contactSheet({ name: 'P', kind: 'picture' },
    [{ slug: 'x', name: 'X', category: 'C', file: 'svg/c/x.svg' }],
    new Map([['svg/c/x.svg', '<svg viewBox="0 0 1 1"/>']]));
  assert.equal(all(parseXml(sheet), 'image').length, 1);
  assert.ok(sheet.includes('data:image/svg+xml;base64,'));
});

test('slugs are shortened in the middle, so icons that differ at the end stay apart', () => {
  const glyph = (slug) => ({ slug, name: 'Generic workflow option', category: 'C', bounds: [0, 0, 10, 10], paths: ['M0 0 L10 0 L10 10 Z'] });
  const sheet = contactSheet({ name: 'L', kind: 'glyph' }, [glyph('generic-workflow-option-1'), glyph('generic-workflow-option-2-v2')], new Map());
  const labels = all(parseXml(sheet), 'text').map((node) => node.text).filter((text) => text.startsWith('generic'));
  assert.equal(new Set(labels).size, 2);
  assert.ok(labels.some((text) => text.endsWith('option-2-v2')));
});

test('each path of a glyph is drawn on its own, filled even-odd', () => {
  const sheet = contactSheet({ name: 'L', kind: 'glyph' },
    [{ slug: 'two', name: 'Two', category: 'C', bounds: [0, 0, 10, 10], paths: ['M0 0 L5 0 L5 5 Z', 'M2 2 L9 2 L9 9 Z'] }], new Map());
  const root = parseXml(sheet);
  assert.equal(all(root, 'path').length, 2);
  assert.ok(sheet.includes('fill-rule="evenodd"'));
  assert.ok(sheet.includes('L: 1 icon<'));
});

test('characters XML cannot hold are left out of labels', () => {
  const sheet = contactSheet({ name: 'L', kind: 'glyph' },
    [{ slug: 'a', name: 'A\u0001B', category: 'C', bounds: [0, 0, 10, 10], paths: ['M0 0 L10 0 L10 10 Z'] }], new Map());
  assert.ok(!sheet.includes('\u0001'));
  assert.ok(sheet.includes('>AB<'));
});
