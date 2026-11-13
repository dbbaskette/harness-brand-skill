import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { USAGE } from '../scripts/pack-brand.mjs';
import { JUDGEMENT, measureTemplate } from '../scripts/lib/pack/measure.mjs';
import { readTokens } from '../scripts/lib/pack/tokens.mjs';
import { makeTemplate } from './fixtures/template.mjs';

const doc = readFileSync(new URL('../docs/brand-pack-format.md', import.meta.url), 'utf8');
const blocks = [...doc.matchAll(/```json\n([\s\S]*?)```/g)].map((m) => JSON.parse(m[1]));
const brand = blocks.find((block) => block.variants && block.aliases);
const layouts = blocks.find((block) => block.variants && !block.aliases && Object.values(block.variants)[0].layouts);
const directions = blocks.find((block) => block.house);
const tokens = blocks.find((block) => Array.isArray(block.colors));
const audit = blocks.find((block) => 'minTextPt' in block);
// A field named in the first column of a table row, alone or beside others.
const row = (field) => new RegExp(`^\\|[^|\\n]*\`${field.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\``, 'm').test(doc);

test('the document shows every pack file it describes as JSON', () => {
  assert.ok(brand && layouts && directions && tokens && audit);
  for (const file of ['brand.json', 'tokens.json', 'templates/<variant>.pptx', 'layouts.json', 'guide.md',
    'directions.json', 'audit.json', 'assets/']) {
    assert.ok(row(file), `the files table has no row for ${file}`);
  }
});

test('the brand.json example gives every required role and type style', () => {
  const variant = brand.variants[brand.defaultVariant];
  for (const role of ['canvasPrimary', 'canvasSecondary', 'inkPrimary', 'inkDeep', 'headingPrimary', 'accentAqua']) {
    assert.ok(variant.colors[role], `the example has no ${role}`);
    assert.ok(row(role), `the roles table has no row for ${role}`);
  }
  for (const style of ['title', 'body', 'bodyReference', 'label', 'caption', 'metric', 'quote']) {
    assert.ok(variant.slides.typography[style], `the example has no ${style} style`);
  }
  for (const field of Object.keys(brand)) assert.ok(row(field), `the brand.json table has no row for ${field}`);
  for (const field of Object.keys(variant.slides)) assert.ok(row(field), `the slides table has no row for ${field}`);
});

test('every field pack measure writes is shown and described', () => {
  const measured = measureTemplate(makeTemplate(), { variant: 'light' });
  const example = Object.values(layouts.variants)[0];
  for (const key of Object.keys(measured)) {
    assert.ok(key in example, `the layouts.json example has no ${key}`);
    assert.ok(row(key), `no row describes ${key}`);
  }
  const layoutKeys = new Set(measured.layouts.flatMap((layout) => Object.keys(layout)));
  for (const key of [...layoutKeys, ...JUDGEMENT]) {
    assert.ok(doc.includes(`\`${key}\``), `the layout tables do not mention ${key}`);
  }
});

test('every field pack tokens writes is described', () => {
  const made = readTokens(new Map([['tokens.json', Buffer.from(JSON.stringify({ name: 'X',
    color: { tokens: [{ name: 'a', value: '#000000' }] }, gradient: {} }))]]));
  for (const key of Object.keys(made)) assert.ok(row(key), `the tokens.json table has no row for ${key}`);
  assert.equal(tokens.schema, 1);
});

test('the directions example holds together, and every audit field is described', () => {
  const variant = Object.values(directions.variants)[0];
  assert.ok(variant.directions.some((direction) => direction.id === variant.default));
  const names = new Set(Object.values(layouts.variants)[0].layouts.map((layout) => layout.name));
  for (const direction of variant.directions) {
    for (const name of Object.values(direction.layouts)) assert.ok(names.has(name), `${name} is not a layout in the example`);
  }
  for (const key of Object.keys(audit)) assert.ok(row(key), `the audit.json table has no row for ${key}`);
});

test('the document names every option of the pack commands it describes', () => {
  for (const option of new Set(USAGE.match(/--[a-z-]+/g))) {
    assert.match(doc, new RegExp(`${option}(?![a-z-])`), `the document does not mention ${option}`);
  }
});

test('the examples agree with each other', () => {
  const variant = brand.variants[brand.defaultVariant];
  const colours = new Set(tokens.colors.map((color) => color.name));
  for (const [role, colour] of Object.entries(variant.colors)) {
    assert.ok(colours.has(colour), `the ${role} role names ${colour}, which the tokens.json example lacks`);
  }
  const roles = new Set(Object.keys(variant.colors));
  const slides = variant.slides;
  const used = [...Object.values(slides.typography).map((style) => style.colorRole), ...slides.chart.seriesRoles,
    slides.table.headerFillRole, slides.table.headerTextRole, slides.icon.colorRole, ...brand.icons.flatMap((each) => each.roles)];
  for (const role of used) assert.ok(roles.has(role), `${role} is used but is not one of the variant's roles`);
  const names = new Set(Object.values(layouts.variants)[0].layouts.map((layout) => layout.name));
  assert.ok(names.has(slides.layout), `the slides layout ${slides.layout} is not a layout in the example`);
  const directionVariant = Object.values(directions.variants)[0];
  for (const closing of Object.values(directionVariant.closing)) assert.ok(names.has(closing.layout), closing.layout);
  for (const direction of directionVariant.directions) {
    const { focal, neutral, meanings } = direction.direction;
    for (const role of [focal, neutral, ...Object.keys(meanings)]) assert.ok(roles.has(role), `${role} is not a role`);
  }
});
