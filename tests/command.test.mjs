import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { readZip, writeZip } from '../scripts/lib/zip.mjs';

const COMMAND = fileURLToPath(new URL('../scripts/harness-brand.mjs', import.meta.url));
const run = (...args) => spawnSync(process.execPath, [COMMAND, ...args], { encoding: 'utf8' });
const SQUARE = '<svg viewBox="0 0 10 10"><rect width="5" height="5"/></svg>';
const LINES = '<svg viewBox="0 0 10 10"><path d="M0 0 L9 9" fill="none" stroke="#000"/></svg>';

function place() {
  const root = mkdtempSync(join(tmpdir(), 'hb-command-'));
  mkdirSync(join(root, 'svgs', 'Cloud'), { recursive: true });
  writeFileSync(join(root, 'svgs', 'Cloud', 'cloud-1.svg'), SQUARE);
  writeFileSync(join(root, 'svgs', 'Cloud', 'drawn.svg'), LINES);
  writeFileSync(join(root, 'index.zip'), writeZip([['assets/Icons/icons.json', JSON.stringify({
    viewBox: '0 0 100 100', note: 'Brand colours only.',
    icons: [{ slug: 'ai-1', name: 'AI 1', category: 'AI', bounds: [0, 0, 9, 9], d: 'M0 0 L9 0 L9 9 Z' }] })]]));
  return root;
}

test('version names Harness Brand and its version', () => {
  const done = run('version');
  assert.equal(done.status, 0);
  const { version } = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8'));
  assert.equal(done.stdout.trim(), `Harness Brand ${version}`);
});

test('with no command it prints its usage, which mentions brands', () => {
  const done = run();
  assert.equal(done.status, 0);
  assert.match(done.stdout, /Usage: harness-brand <command>/);
  assert.match(done.stdout, /brands/);
});

test('an unknown command is refused with the usage', () => {
  const done = run('juggle');
  assert.equal(done.status, 2);
  assert.match(done.stderr, /juggle is not a Harness Brand command/);
});

test('pack icons builds a library and its contact sheet, then pack check passes it', () => {
  const root = place();
  const into = join(root, 'icon-libraries', 'test-icons');
  const done = run('pack', 'icons', join(root, 'index.zip'), join(root, 'svgs'),
    '--library', 'test-icons', '--name', 'Test icons', '--into', into, '--json');
  assert.equal(done.status, 0, done.stderr);
  const report = JSON.parse(done.stdout);
  assert.equal(report.icons, 2);
  assert.deepEqual(report.skipped.map((s) => s.reason), ['it is drawn with lines, not filled shapes']);
  const files = readZip(readFileSync(join(into, 'library.zip')));
  assert.equal(JSON.parse(files.get('library.json').toString()).usage, 'Brand colours only.');
  assert.ok(existsSync(join(into, 'contact-sheet.svg')));
  const checked = run('pack', 'check', into);
  assert.equal(checked.status, 0, checked.stdout + checked.stderr);
  assert.match(checked.stdout, /Test icons passes: 2 glyph icons/);
});

test('pack icons will not replace a library unless told to', () => {
  const root = place();
  const into = join(root, 'lib');
  assert.equal(run('pack', 'icons', join(root, 'svgs'), '--library', 'lib', '--name', 'L', '--into', into).status, 0);
  const again = run('pack', 'icons', join(root, 'svgs'), '--library', 'lib', '--name', 'L', '--into', into);
  assert.equal(again.status, 1);
  assert.match(again.stderr, /already has a library\.zip/);
  assert.equal(run('pack', 'icons', join(root, 'svgs'), '--library', 'lib', '--name', 'L', '--into', into, '--replace').status, 0);
});

test('pack icons takes a fill for one source by its file name', () => {
  const root = place();
  const into = join(root, 'lib');
  const done = run('pack', 'icons', join(root, 'svgs'), '--library', 'lib', '--name', 'L', '--into', into,
    '--fill-for', 'svgs=0.5', '--json');
  assert.equal(done.status, 0, done.stderr);
  const icons = JSON.parse(readZip(readFileSync(join(into, 'library.zip'))).get('icons.json').toString()).icons;
  assert.deepEqual(icons[0].bounds, [25, 25, 50, 50]);
});

test('pack check names the problems and fails', () => {
  const root = mkdtempSync(join(tmpdir(), 'hb-check-'));
  writeFileSync(join(root, 'library.zip'), writeZip([['library.json', '{}']]));
  const done = run('pack', 'check', root);
  assert.equal(done.status, 1);
  assert.match(done.stdout, /library\.zip has no icons\.json/);
  const empty = run('pack', 'check', mkdtempSync(join(tmpdir(), 'hb-empty-')));
  assert.equal(empty.status, 1);
  assert.match(empty.stderr, /has no library\.zip/);
});

test('missing options are refused in a sentence', () => {
  const done = run('pack', 'icons', '--library', 'x');
  assert.equal(done.status, 1);
  assert.match(done.stderr, /Name at least one source/);
});

test('a --fill-for that names no source is refused, and nothing is written', () => {
  const root = place();
  const into = join(root, 'lib');
  const done = run('pack', 'icons', join(root, 'svgs'), '--library', 'lib', '--name', 'L', '--into', into, '--fill-for', 'svgz=0.5');
  assert.equal(done.status, 1);
  assert.match(done.stderr, /--fill-for svgz matches no source/);
  assert.ok(!existsSync(join(into, 'library.zip')));
});

test('the folder must be named for the library', () => {
  const root = place();
  const done = run('pack', 'icons', join(root, 'svgs'), '--library', 'foo', '--name', 'F', '--into', join(root, 'bar'));
  assert.equal(done.status, 1);
  assert.match(done.stderr, /named for the library/);
  assert.ok(!existsSync(join(root, 'bar')));
});

test('a refused rebuild leaves the library as it was', () => {
  const root = place();
  const into = join(root, 'lib');
  assert.equal(run('pack', 'icons', join(root, 'svgs'), '--library', 'lib', '--name', 'L', '--into', into).status, 0);
  const before = readFileSync(join(into, 'library.zip'));
  const done = run('pack', 'icons', join(root, 'missing'), '--library', 'lib', '--name', 'L', '--into', into, '--replace');
  assert.equal(done.status, 1);
  assert.deepEqual(readFileSync(join(into, 'library.zip')), before);
});

test('system errors are told in a sentence', () => {
  const root = place();
  writeFileSync(join(root, 'lib'), 'a file where the folder should be');
  const done = run('pack', 'icons', join(root, 'svgs'), '--library', 'lib', '--name', 'L', '--into', join(root, 'lib'));
  assert.equal(done.status, 1);
  assert.doesNotMatch(done.stderr, /^E[A-Z]+:/m);
  assert.match(done.stderr, /Could not use/);
});

test('pack icons records the source and usage it is given', () => {
  const root = place();
  const into = join(root, 'lib');
  const done = run('pack', 'icons', join(root, 'svgs'), '--library', 'lib', '--name', 'L', '--into', into,
    '--source', 'Example icons, 2026', '--usage', 'Brand colours only.');
  assert.equal(done.status, 0, done.stderr);
  const library = JSON.parse(readZip(readFileSync(join(into, 'library.zip'))).get('library.json').toString());
  assert.equal(library.source, 'Example icons, 2026');
  assert.equal(library.usage, 'Brand colours only.');
});

test('two sources with the same name are refused', () => {
  const root = place();
  mkdirSync(join(root, 'other', 'svgs', 'Cloud'), { recursive: true });
  writeFileSync(join(root, 'other', 'svgs', 'Cloud', 'one.svg'), SQUARE);
  const done = run('pack', 'icons', join(root, 'svgs'), join(root, 'other', 'svgs'),
    '--library', 'lib', '--name', 'L', '--into', join(root, 'lib'));
  assert.equal(done.status, 1);
  assert.match(done.stderr, /Two sources are both named svgs/);
});
