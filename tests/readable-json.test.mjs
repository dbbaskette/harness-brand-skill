import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readableJson } from '../scripts/lib/readable-json.mjs';

test('it reads back as the same value', () => {
  const value = { schema: 1, list: [1, 2, 3], nested: { a: [{ b: 'x'.repeat(120) }], c: null }, empty: [], none: {} };
  assert.deepEqual(JSON.parse(readableJson(value)), value);
});

test('short values, lists of plain values and small flat objects stay on one line', () => {
  const long = 'y'.repeat(120);
  assert.equal(readableJson({ bounds: [1, 2, 3, 4], layouts: [{ id: 'a', name: 'b' }, { id: 'c', notes: long }] }),
    `{\n  "bounds": [1,2,3,4],\n  "layouts": [\n    {"id":"a","name":"b"},\n    {"id":"c","notes":"${long}"}\n  ]\n}\n`);
});

test('an object holding a long nested value opens up', () => {
  const long = 'z'.repeat(120);
  assert.equal(readableJson({ theme: { part: 'p', colors: { dk1: long } } }),
    `{\n  "theme": {\n    "part": "p",\n    "colors": {"dk1":"${long}"}\n  }\n}\n`);
});

test('undefined and functions are left out of objects and written as null in lists, as JSON.stringify does', () => {
  const long = 'y'.repeat(120);
  const value = { list: [{ a: long }, undefined, () => 1, { b: long }], f() {}, s: Symbol('x'), keep: long };
  assert.deepEqual(JSON.parse(readableJson(value)), JSON.parse(JSON.stringify(value)));
});
