import { test } from 'node:test';
import assert from 'node:assert/strict';
import { hexColor, parseThemes, readTokens } from '../scripts/lib/pack/tokens.mjs';

const TOKENS = {
  name: 'Example Co', version: 1,
  color: { themes: [{ id: 'light', name: 'Light' }, { id: 'dark', name: 'Dark' }], tokens: [
    { name: 'blue', value: '#005C8A', usage: 'Headings.' },
    { name: 'white', value: '#fff', usage: 'Ground.' },
    { name: 'ink', value: 'rgb(0, 0, 0)' },
  ] },
  type: { families: { sans: 'Arial, sans-serif' }, groups: [
    { name: 'Titles', family: 'sans', styles: [{ name: 'title', fontSize: '36px', lineHeight: '39px', fontWeight: 400, usage: 'Slide titles.' }] },
    { name: 'Body', styles: [{ name: 'body', fontSize: '20px', fontWeight: 400 }] },
  ] },
  spacing: { tokens: [{ name: 'space-margin', value: '48px', usage: 'Slide margin.' }] },
  radius: { tokens: [{ name: 'radius-none', value: '0' }] },
  gradient: { tokens: [{ name: 'gradient-bar', value: 'linear-gradient(90deg, #61a60e, #6c4b94)' }] },
};
const CSS = `/* generated */
:root, [data-theme="light"] {
  --blue: #005c8a;
  --white: #ffffff;
  --ink: var(--black, #000000);
  --surface: var(--white);
}
[data-theme="dark"] {
  --blue: #0088ef;
  --ink: var(--white);
  --surface: var(--blue);
}
.t-title { font-size: 36px; }`;
const files = (tokens = TOKENS, css = CSS) => new Map([['export/tokens.json', Buffer.from(JSON.stringify(tokens))],
  ...(css === null ? [] : [['export/tokens.css', Buffer.from(css)]])]);

test('colours are written as #rrggbb wherever a plain colour is given', () => {
  assert.equal(hexColor('#ABC'), '#aabbcc');
  assert.equal(hexColor('#005C8A'), '#005c8a');
  assert.equal(hexColor('#005c8aff'), '#005c8a');
  assert.equal(hexColor('rgb(0%, 100%, 0%)'), '#00ff00');
  assert.equal(hexColor('rgba(255, 0, 0, 1)'), '#ff0000');
  assert.equal(hexColor('rgba(255, 0, 0, 0.5)'), null);
  assert.equal(hexColor('var(--blue)'), null);
});

test('tokens.css gives each theme its properties', () => {
  const themes = parseThemes(CSS);
  assert.equal(themes.light.blue, '#005c8a');
  assert.equal(themes.dark.blue, '#0088ef');
  assert.equal(themes.light['font-size'], undefined);
});

test('each colour gets its light value and, where the dark theme differs, its dark value', () => {
  const made = readTokens(files());
  assert.deepEqual(made.colors, [
    { name: 'blue', light: '#005c8a', dark: '#0088ef', usage: 'Headings.' },
    { name: 'white', light: '#ffffff', usage: 'Ground.' },
    { name: 'ink', light: '#000000', dark: '#ffffff' },
    { name: 'surface', light: '#ffffff', dark: '#0088ef', usage: 'Named in tokens.css only.' },
  ]);
  assert.deepEqual(made.themes, ['light', 'dark']);
});

test('type styles keep their values and say their group, and the rest is kept', () => {
  const made = readTokens(files());
  assert.deepEqual(made.type.families, { sans: 'Arial, sans-serif' });
  assert.deepEqual(made.type.styles, [
    { name: 'title', fontSize: '36px', lineHeight: '39px', fontWeight: 400, usage: 'Slide titles.', group: 'Titles', family: 'sans' },
    { name: 'body', fontSize: '20px', fontWeight: 400, group: 'Body' },
  ]);
  assert.deepEqual(made.spacing, [{ name: 'space-margin', value: '48px', usage: 'Slide margin.' }]);
  assert.deepEqual(Object.keys(made.other), ['gradient']);
  assert.deepEqual(made.source, { name: 'Example Co', version: 1, file: 'export/tokens.json' });
});

test('without tokens.css, colours keep the values tokens.json gives', () => {
  const made = readTokens(files(TOKENS, null));
  assert.deepEqual(made.colors.map((color) => [color.name, color.light, color.dark]),
    [['blue', '#005c8a', undefined], ['white', '#ffffff', undefined], ['ink', '#000000', undefined]]);
});

test('an export without usable tokens is refused in a sentence', () => {
  assert.throws(() => readTokens(new Map([['a.svg', Buffer.from('<svg/>')]])), /holds no tokens\.json/);
  assert.throws(() => readTokens(new Map([['tokens.json', Buffer.from('{bad')]])), /tokens\.json is not JSON/);
  assert.throws(() => readTokens(new Map([['tokens.json', Buffer.from('{}')]])), /no colour tokens/);
});

test('values given as {light, dark} objects or {name} aliases are read as Claude Design writes them', () => {
  const made = readTokens(new Map([['tokens.json', Buffer.from(JSON.stringify({ name: 'X', color: { tokens: [
    { name: 'white', value: '#ffffff' },
    { name: 'blue', value: { light: '#005c8a', dark: '#0088ef' } },
    { name: 'border', value: '{blue}' },
    { name: 'ground', value: { light: '{white}', dark: '#1b1d36' } },
  ] } }))]]));
  assert.deepEqual(made.colors.map((color) => [color.name, color.light, color.dark]), [
    ['white', '#ffffff', undefined], ['blue', '#005c8a', '#0088ef'], ['border', '#005c8a', '#0088ef'], ['ground', '#ffffff', '#1b1d36']]);
});

test('only rules for the whole page set a theme, and a last declaration needs no semicolon', () => {
  const themes = parseThemes(`:root{--a:#111111}[data-theme="dark"]{--a:#aaaaaa}
    @media (prefers-color-scheme: dark) { :root { --a: #bbbbbb; } }
    :root.dark { --a: #cccccc; }
    :root:not([data-theme="dark"]) { --a: #dddddd; }
    .dark { --a: #eeeeee; }
    [data-theme='dark'] .card { --a: #999999; }
    html[data-theme='dark'] { --b: #123456 !important; }`);
  assert.deepEqual(themes, { light: { a: '#111111' }, dark: { a: '#aaaaaa', b: '#123456' } });
});

test('a colour set only for light follows a variable the dark theme changes, and fallbacks are followed', () => {
  const css = ':root { --a: #111111; --b: var(--a); --c: var(--missing, var(--a)); } [data-theme="dark"] { --a: #222222; }';
  const made = readTokens(new Map([['tokens.json', Buffer.from(JSON.stringify({ name: 'X', color: { tokens: [
    { name: 'b', value: '#000000' }, { name: 'c', value: '#000000' }] } }))], ['tokens.css', Buffer.from(css)]]));
  assert.deepEqual(made.colors.map((color) => [color.name, color.light, color.dark]),
    [['b', '#111111', '#222222'], ['c', '#111111', '#222222'], ['a', '#111111', '#222222']]);
  assert.equal(hexColor('rgb(0 0 0)'), '#000000');
  assert.equal(hexColor('rgb(255 0 0 / 50%)'), null);
});
