import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { JUDGEMENT } from '../scripts/lib/pack/measure.mjs';

const guide = readFileSync(new URL('../references/building-a-pack.md', import.meta.url), 'utf8');

test('the authoring guide walks through every pack command, in order', () => {
  const at = ['tokens', 'measure', 'previews', 'scaffold', 'check', 'seal'].map((command) => guide.indexOf(`harness-brand pack ${command} `));
  assert.ok(at.every((place) => place >= 0), 'the guide does not show every command');
  assert.deepEqual([...at].sort((a, b) => a - b), at);
});

test('the authoring guide links to the format, names the guide headings and every layout field', () => {
  for (const [, link] of guide.matchAll(/\]\((\.\.\/[^)]+)\)/g)) {
    assert.ok(existsSync(new URL(link, new URL('../references/', import.meta.url))), `${link} does not exist`);
  }
  for (const field of JUDGEMENT) assert.ok(guide.includes(`\`${field}\``), `the guide does not mention ${field}`);
  assert.match(guide, /under the three headings/);
  assert.match(guide, /Remove `draft`/);
});
