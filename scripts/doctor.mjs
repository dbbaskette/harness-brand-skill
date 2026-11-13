// harness-brand doctor: whether this computer is ready to make branded slides. Never uses the network.
import { spawnSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseArgs } from 'node:util';
import { dataFolder, listPacks, missingData } from './lib/worker/brands.mjs';
import { findTool } from './lib/pack/previews.mjs';
import { findSlides, MINIMUM } from './lib/worker/slides.mjs';
import { VERSION } from './version.mjs';

const FONT_PLACES = ['/System/Library/Fonts/Supplemental/Arial.ttf', '/Library/Fonts/Arial.ttf',
  join(homedir(), 'Library', 'Fonts', 'Arial.ttf'), '/usr/share/fonts/truetype/msttcorefonts/Arial.ttf',
  'C:\\Windows\\Fonts\\arial.ttf'];

function hasArial() {
  if (FONT_PLACES.some((place) => existsSync(place))) return true;
  const listed = spawnSync('fc-list', [':family=Arial'], { encoding: 'utf8' });
  return listed.status === 0 && /arial/i.test(listed.stdout);
}

export function report() {
  const capabilities = [];
  const nodeMajor = Number(process.versions.node.split('.')[0]);
  capabilities.push(nodeMajor >= 20 ? { name: 'node', status: 'available', version: process.versions.node }
    : { name: 'node', status: 'missing', next: 'Install Node.js 20 or newer.' });
  capabilities.push(hasArial() ? { name: 'arial', status: 'available' }
    : { name: 'arial', status: 'missing', next: 'Install licensed Arial, so slides are drawn in the brand font.' });
  try {
    const slides = findSlides();
    capabilities.push({ name: 'harness-slides', status: 'available', version: slides.version, root: slides.root });
  } catch (error) {
    capabilities.push({ name: 'harness-slides', status: 'missing', minimum: MINIMUM, next: error.message });
  }
  for (const tool of ['soffice', 'pdftoppm']) {
    let found = null;
    try { found = findTool(tool); } catch { found = null; }
    capabilities.push(found ? { name: tool === 'soffice' ? 'libreoffice' : tool, status: 'available', path: found }
      : { name: tool === 'soffice' ? 'libreoffice' : tool, status: 'missing', next: 'Needed only to draw previews: install LibreOffice and Poppler.' });
  }
  const brands = dataFolder();
  const packs = listPacks(brands);
  const usable = packs.filter((each) => !each.problems.length);
  capabilities.push(usable.length ? { name: 'brand packs', status: 'available', brands: usable.map((each) => each.id), folder: brands }
    : { name: 'brand packs', status: 'missing', next: missingData(brands) });
  const needed = ['node', 'harness-slides', 'brand packs'];
  const checks = capabilities.filter((each) => needed.includes(each.name)).map((each) => ({ name: each.name, ok: each.status === 'available' }));
  const ok = checks.every((each) => each.ok);
  return {
    profile: 'presentation',
    ok,
    installation: { version: VERSION, root: fileURLToPath(new URL('..', import.meta.url)).replace(/\/$/, ''), data: brands },
    checks,
    ready: ok,
    capabilities,
    manual: capabilities.filter((each) => each.status !== 'available' && each.next).map((each) => each.next),
    unusable: packs.filter((each) => each.problems.length).map((each) => ({ brand: each.id, problem: each.problems[0] })),
  };
}

export function main(args) {
  const { values } = parseArgs({ args, options: { profile: { type: 'string', default: 'presentation' },
    format: { type: 'string' }, json: { type: 'boolean', default: false } } });
  if (values.profile !== 'presentation') throw new Error('Harness Brand checks the presentation profile only: give --profile presentation.');
  if (values.format !== undefined && !['pptx', 'google-slides'].includes(values.format)) throw new Error('Give --format pptx or google-slides.');
  const result = report();
  if (values.json) {
    console.log(JSON.stringify(result, null, 2));
  } else {
    console.log(`Harness Brand ${VERSION}: ${result.ok ? 'ready' : 'not ready'}.`);
    for (const each of result.capabilities) console.log(`  ${each.name}: ${each.status}${each.next ? `. ${each.next}` : ''}`);
    for (const each of result.unusable) console.log(`  ${each.brand}: not usable: ${each.problem}`);
  }
  return result.ok ? 0 : 1;
}
