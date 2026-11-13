import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { cpSync, existsSync, lstatSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, realpathSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { readZip } from '../scripts/lib/zip.mjs';
import { makeBrands } from './fixtures/pack.mjs';
import { sha256 } from '../scripts/lib/pack/check.mjs';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
const run = (script, home, ...args) => spawnSync(process.execPath, [join(ROOT, 'scripts', script), ...args], { encoding: 'utf8',
  env: { PATH: process.env.PATH, HOME: home } });

test('the installer keeps the release in the shared place, links each skills folder to it, and records the brands folder', () => {
  const home = mkdtempSync(join(tmpdir(), 'hb-home-'));
  mkdirSync(join(home, '.agents'));
  const { brands: data } = makeBrands();
  const done = spawnSync(process.execPath, [join(ROOT, 'scripts', 'install-mac.mjs'), '--yes', '--research', 'skip'], { encoding: 'utf8',
    env: { PATH: process.env.PATH, HOME: home, HARNESS_BRAND_DATA: data } });
  assert.equal(done.status, 0, done.stderr);
  assert.match(done.stdout.trim().split('\n').at(-1), /^Harness Brand \d+\.\d+\.\d+ is installed for Claude Code, Codex, Agents\.$/);
  const { version } = JSON.parse(readFileSync(join(ROOT, 'package.json'), 'utf8'));
  const shared = process.platform === 'darwin' ? join(home, 'Library', 'Application Support', 'Harness Brand') : join(home, '.local', 'share', 'harness-brand');
  assert.equal(realpathSync(join(shared, 'current')), realpathSync(join(shared, 'versions', version)));
  for (const place of ['.claude/skills/harness-brand', '.codex/skills/harness-brand', '.agents/skills/harness-brand']) {
    assert.ok(lstatSync(join(home, place)).isSymbolicLink(), `${place} is a link`);
    assert.ok(existsSync(join(home, place, 'SKILL.md')), place);
    assert.ok(!existsSync(join(home, place, 'tests')), `${place} holds no tests`);
    assert.match(spawnSync(process.execPath, [join(home, place, 'scripts', 'harness-brand.mjs'), 'version'], { encoding: 'utf8' }).stdout, /^Harness Brand /);
  }
  assert.equal(readFileSync(join(home, '.config', 'harness-brand', 'data'), 'utf8'), `${data}\n`);
  assert.ok(!readdirSync(join(shared, 'versions')).some((name) => name.startsWith('.')), 'no staging folder is left');
  assert.equal(run('install-skill.mjs', home, '--research', 'skip').status, 0, 'installing again keeps the links');
  assert.match(run('install-skill.mjs', home, '--research', 'skip').stdout, /already links to it/);
});

test('the installer refuses a folder that is not Harness Brand, and changes nothing', () => {
  const home = mkdtempSync(join(tmpdir(), 'hb-home-'));
  mkdirSync(join(home, '.claude', 'skills', 'harness-brand'), { recursive: true });
  writeFileSync(join(home, '.claude', 'skills', 'harness-brand', 'notes.txt'), 'mine');
  const done = run('install-skill.mjs', home, '--research', 'skip');
  assert.equal(done.status, 1);
  assert.match(done.stderr, /holds something other than Harness Brand\. Nothing was installed/);
  assert.equal(readFileSync(join(home, '.claude', 'skills', 'harness-brand', 'notes.txt'), 'utf8'), 'mine');
  assert.ok(!existsSync(join(home, '.codex', 'skills', 'harness-brand')));
  assert.match(run('install-mac.mjs', home, '--research', 'skip').stderr, /Rerun with --yes/);
});

test('a release is one zip with harness-brand/ at its root and a two-word checksum file', () => {
  const output = mkdtempSync(join(tmpdir(), 'hb-dist-'));
  const done = spawnSync(process.execPath, [join(ROOT, 'scripts', 'package.mjs'), '--output', output], { encoding: 'utf8' });
  assert.equal(done.status, 0, done.stderr);
  const { version } = JSON.parse(readFileSync(join(ROOT, 'package.json'), 'utf8'));
  const name = `harness-brand-${version}-mac.zip`;
  const archive = readFileSync(join(output, name));
  assert.equal(readFileSync(join(output, `${name}.sha256`), 'utf8'), `${sha256(archive)}  ${name}\n`);
  const names = [...readZip(archive).keys()];
  assert.ok(names.every((each) => each.startsWith('harness-brand/')));
  for (const needed of ['harness-brand/SKILL.md', 'harness-brand/package.json', 'harness-brand/scripts/harness-brand.mjs',
    'harness-brand/scripts/install-mac.mjs', 'harness-brand/scripts/install-skill.mjs', 'harness-brand/scripts/lib/harness-install-sources.json']) {
    assert.ok(names.includes(needed), needed);
  }
  assert.ok(!names.some((each) => each.includes('/tests/') || each.includes('apply-brand') || each.endsWith('.zip')));
  assert.match(readFileSync(join(ROOT, 'scripts', 'harness-brand.mjs'), 'utf8'), /\bbrands\b/, 'Marketing Studio finds the skill by this word');
});

const pointer = (home) => join(home, '.config', 'harness-brand', 'data');
const interactive = (home, body, ...args) => spawnSync(process.execPath, ['--input-type=module', '-e',
  `import { run } from ${JSON.stringify(new URL('../scripts/install-skill.mjs', import.meta.url).href)};
   process.exitCode = run(${JSON.stringify(args)}, { confirm: () => true, ${body} });`],
{ encoding: 'utf8', env: { PATH: process.env.PATH, HOME: home } });

test('an explicit brands folder supports spaces and tilde, and replaces the saved choice', () => {
  const home = mkdtempSync(join(tmpdir(), 'hb-home-'));
  const { brands } = makeBrands();
  const selected = join(home, 'My Brands');
  cpSync(brands, selected, { recursive: true });
  mkdirSync(join(home, '.config', 'harness-brand'), { recursive: true });
  writeFileSync(pointer(home), '/missing/old-brands\n');
  const done = run('install-mac.mjs', home, '--yes', '--data', '~/My Brands');
  assert.equal(done.status, 0, done.stderr);
  assert.equal(readFileSync(pointer(home), 'utf8'), `${selected}\n`);
  const installed = join(home, '.codex', 'skills', 'harness-brand', 'scripts', 'harness-brand.mjs');
  const listed = spawnSync(process.execPath, [installed, 'brands', '--json'], {
    encoding: 'utf8', env: { PATH: process.env.PATH, HOME: home },
  });
  assert.equal(listed.status, 0, listed.stderr);
  assert.deepEqual(JSON.parse(listed.stdout).map((each) => each.brand), ['example']);
  assert.ok(existsSync(join(selected, 'example', 'pack', 'brand.json')), 'the external pack is retained');
});

test('interactive installation asks for the folder once, then upgrades reuse it without asking', () => {
  const home = mkdtempSync(join(tmpdir(), 'hb-home-'));
  const { brands } = makeBrands();
  const first = interactive(home, `askData: () => ${JSON.stringify(brands)}`);
  assert.equal(first.status, 0, first.stderr);
  assert.equal(readFileSync(pointer(home), 'utf8'), `${brands}\n`);
  const next = interactive(home, 'askData: () => { throw new Error("must not prompt on upgrade"); }');
  assert.equal(next.status, 0, next.stderr);
  assert.equal(readFileSync(pointer(home), 'utf8'), `${brands}\n`);
});

test('unattended installation and an empty interactive answer can configure brands later', () => {
  for (const unattended of [true, false]) {
    const home = mkdtempSync(join(tmpdir(), 'hb-home-'));
    const done = unattended ? interactive(home, 'askData: () => { throw new Error("must not prompt with --yes"); }', '--yes')
      : interactive(home, 'askData: () => ""');
    assert.equal(done.status, 0, done.stderr);
    assert.match(done.stdout, /No brands folder selected.*data --set/);
    assert.ok(!existsSync(pointer(home)));
    assert.ok(existsSync(join(home, '.codex', 'skills', 'harness-brand', 'SKILL.md')));
  }
});

test('invalid folders and single packs fail before installation or a saved choice is changed', () => {
  const { brands } = makeBrands();
  const empty = mkdtempSync(join(tmpdir(), 'hb-empty-'));
  for (const data of ['', join(empty, 'missing'), empty, join(brands, 'example', 'pack')]) {
    const home = mkdtempSync(join(tmpdir(), 'hb-home-'));
    mkdirSync(join(home, '.config', 'harness-brand'), { recursive: true });
    writeFileSync(pointer(home), `${brands}\n`);
    const done = run('install-mac.mjs', home, '--yes', '--data', data);
    assert.equal(done.status, 1, `${data}: ${done.stdout}`);
    assert.equal(readFileSync(pointer(home), 'utf8'), `${brands}\n`);
    assert.ok(!existsSync(join(home, '.codex')));
    assert.ok(!existsSync(join(home, '.claude')));
  }
});

test('dry-run shows the selected brands without prompting, installing or saving the path', () => {
  const home = mkdtempSync(join(tmpdir(), 'hb-home-'));
  const { brands } = makeBrands();
  const done = run('install-mac.mjs', home, '--dry-run', '--data', brands);
  assert.equal(done.status, 0, done.stderr);
  assert.match(done.stdout, /Example Co/);
  assert.ok(!existsSync(pointer(home)));
  assert.ok(!existsSync(join(home, '.codex')));
  const help = run('install-mac.mjs', home, '--help');
  assert.equal(help.status, 0, help.stderr);
  assert.match(help.stdout, /--data FOLDER/);
});

test('an explicit folder wins at installation while explaining an environment override', () => {
  const home = mkdtempSync(join(tmpdir(), 'hb-home-'));
  const { brands } = makeBrands();
  const { brands: other } = makeBrands();
  const done = spawnSync(process.execPath, [join(ROOT, 'scripts', 'install-mac.mjs'), '--yes', '--data', brands], {
    encoding: 'utf8', env: { PATH: process.env.PATH, HOME: home, HARNESS_BRAND_DATA: other },
  });
  assert.equal(done.status, 0, done.stderr);
  assert.equal(readFileSync(pointer(home), 'utf8'), `${brands}\n`);
  assert.match(done.stdout, /HARNESS_BRAND_DATA.*overrides the saved folder/);
});


test('installation honors a custom configuration directory when saving the brands folder', () => {
  const home = mkdtempSync(join(tmpdir(), 'hb-home-'));
  const config = join(home, 'custom config');
  const { brands } = makeBrands();
  const done = spawnSync(process.execPath, [join(ROOT, 'scripts', 'install-mac.mjs'), '--yes', '--data', brands], {
    encoding: 'utf8', env: { PATH: process.env.PATH, HOME: home, XDG_CONFIG_HOME: config },
  });
  assert.equal(done.status, 0, done.stderr);
  assert.equal(readFileSync(join(config, 'harness-brand', 'data'), 'utf8'), `${brands}\n`);
  assert.ok(!existsSync(pointer(home)), 'no ignored setting is written to the default location');
});
