#!/usr/bin/env node
// Install Harness Brand for Claude Code and Codex from this release folder. Never prompts.
// --research is accepted, as Marketing Studio's installers pass it, and nothing is done with it.
import { realpathSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseArgs } from 'node:util';
import { install, plan } from './lib/install.mjs';
import { checkedData, findData } from './lib/worker/brands.mjs';
import { findSlides } from './lib/worker/slides.mjs';
import { profiles } from './rebrand.mjs';
import { spawnSync } from 'node:child_process';
import { join } from 'node:path';
import { VERSION } from './version.mjs';

export function run(args, { confirm, askData } = {}) {
  const { values } = parseArgs({ args, options: { yes: { type: 'boolean', default: false }, replace: { type: 'boolean', default: false },
    'dry-run': { type: 'boolean', default: false }, data: { type: 'string' }, rebrand: { type: 'string', default: 'auto' }, 'replace-brand-shortcuts': { type: 'boolean', default: false }, help: { type: 'boolean', default: false }, research: { type: 'string', default: 'skip' } } });
  if (values.help) {
    console.log('Usage: node scripts/install-mac.mjs [--data FOLDER] [--yes] [--dry-run] [--replace] [--rebrand auto|skip] [--replace-brand-shortcuts]');
    console.log('Choose the parent folder containing <brand>/pack/ directories. Without --data, keep the configured folder or ask during an interactive install. Enter to configure later. --yes never prompts.');
    return 0;
  }
  if (!['auto','skip'].includes(values.rebrand)) throw new Error('Give --rebrand auto or skip.');
  if (!['skip', 'check', 'install'].includes(values.research)) throw new Error('Give --research skip, check or install.');
  if (Number(process.versions.node.split('.')[0]) < 20) throw new Error('Harness Brand needs Node.js 20 or newer.');
  const source = fileURLToPath(new URL('..', import.meta.url));
  if (!values['dry-run'] && confirm && !values.yes && !confirm()) { console.log('Nothing was installed.'); return 1; }
  let data = values.data;
  let replaceData = data !== undefined;
  if (data === undefined) data = findData().folder;
  if (data == null && !values['dry-run'] && !values.yes && askData) {
    data = askData().trim() || undefined;
    replaceData = Boolean(data);
  }
  const checked = data !== undefined && data !== null ? checkedData(data) : null;
  if (checked) console.log(`Brands folder: ${checked.folder} (${checked.brands.join(', ')}).`);
  else console.log('No brands folder selected. Configure later with: node scripts/harness-brand.mjs data --set "/path/to/brands"');
  if (values['dry-run']) {
    for (const step of plan(source)) console.log(`${step.label}: ${step.action}${step.reason ? ` (${step.reason})` : ''} at ${step.root}`);
    return 0;
  }
  const { steps, root: installedRoot } = install(source, { replace: values.replace, data: checked?.folder, replaceData });
  if (replaceData && process.env.HARNESS_BRAND_DATA) {
    console.log('HARNESS_BRAND_DATA is set in this shell and overrides the saved folder. Unset it to use the saved choice.');
  }
  if (values.rebrand === 'auto' && checked && profiles(checked.folder).length) {
    const setup = spawnSync(process.execPath, [join(installedRoot, 'scripts', 'harness-brand.mjs'), '--data', checked.folder,
      'rebrand', 'setup', ...(values['replace-brand-shortcuts'] ? ['--replace-brand-shortcuts'] : [])], { stdio: 'inherit' });
    if (setup.error || setup.status !== 0) throw new Error('Harness Brand is installed, but rebranding setup is incomplete. Resolve the reported problem and run rebrand setup again.');
  }
  try {
    const slides = findSlides();
    console.log(`Harness Slides ${slides.version} is installed at ${slides.root}.`);
  } catch (error) {
    console.log(error.message);
  }
  console.log(`Harness Brand ${VERSION} is installed for ${steps.map((step) => step.label).join(', ')}.`);
  return 0;
}

if (process.argv[1] && realpathSync(resolve(process.argv[1])) === realpathSync(fileURLToPath(import.meta.url))) {
  try { process.exitCode = run(process.argv.slice(2)); } catch (error) { console.error(error.message); process.exitCode = 1; }
}
