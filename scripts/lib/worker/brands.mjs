// Finding the brands folder and the brand packs in it, for the commands the studios run.
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { homedir } from 'node:os';
import { join, resolve } from 'node:path';
import { sharedRoot } from '../install.mjs';
import { checkPack } from '../pack/check.mjs';

const RESERVED = 'icon-libraries';

/** The file that records the brands folder for studios that pass no environment: one line, the folder. */
export function pointerFile({ environment = process.env, home = homedir() } = {}) {
  return join(environment.XDG_CONFIG_HOME || join(home, '.config'), 'harness-brand', 'data');
}

/** The local brands folder, in Harness Brand's shared place: where `data --install` copies brands. */
export function localFolder({ home = homedir(), platform = process.platform } = {}) {
  return join(sharedRoot({ home, platform }), 'brands');
}

/** The brands folder and what named it: --data, else HARNESS_BRAND_DATA, else the folder the
 *  pointer file records, else the local brands folder when it exists. {folder: null} when none is. */
export function findData({ data, environment = process.env, home = homedir(), platform = process.platform } = {}) {
  const given = data ?? environment.HARNESS_BRAND_DATA;
  if (given) return { folder: resolve(given), from: 'HARNESS_BRAND_DATA' };
  try {
    const recorded = readFileSync(pointerFile({ environment, home }), 'utf8').trim();
    if (recorded) return { folder: resolve(recorded), from: pointerFile({ environment, home }) };
  } catch { /* nothing recorded */ }
  const local = localFolder({ home, platform });
  return existsSync(local) ? { folder: local, from: 'local' } : { folder: null, from: null };
}

/** The brands folder (see findData), or null when none is given, recorded or installed. */
export function dataFolder(options = {}) {
  return findData(options).folder;
}

/** Every pack in the brands folder, usable or not: [{id, pack, brand, problems}], by id. */
export function listPacks(brands) {
  if (!brands || !existsSync(brands) || !statSync(brands).isDirectory()) return [];
  return readdirSync(brands).sort()
    .filter((name) => name !== RESERVED && !name.startsWith('.') && existsSync(join(brands, name, 'pack', 'brand.json')))
    .map((id) => {
      const pack = join(brands, id, 'pack');
      const problems = checkPack(pack);
      let brand = null;
      try { brand = JSON.parse(readFileSync(join(pack, 'brand.json'), 'utf8')); } catch { /* reported by checkPack */ }
      return { id, pack, brand, problems };
    });
}

/** Validate a user-selected brands root before saving settings or installing anything. */
export function checkedData(given) {
  if (typeof given !== 'string' || !given.trim()) throw new Error('Give the parent brands folder with --data FOLDER.');
  const folder = resolve(given === '~' ? homedir() : given.startsWith('~/') ? join(homedir(), given.slice(2)) : given);
  if (!existsSync(folder) || !statSync(folder).isDirectory()) throw new Error(`There is no folder at ${folder}. Choose another with --data FOLDER.`);
  const packs = listPacks(folder);
  const usable = packs.filter((each) => !each.problems.length);
  if (!usable.length) {
    const detail = packs.find((each) => each.problems.length);
    throw new Error(`${folder} holds no usable brand packs. Choose the parent folder containing <brand>/pack/brand.json, not a single pack or a folder of source artwork.${detail ? ` ${detail.id}: ${detail.problems[0]}` : ''}`);
  }
  return { folder, brands: usable.map((each) => each.brand.name) };
}

/** The sentence a command that needs a brand gives when it has none to use. */
export function missingData(brands) {
  if (!brands) return 'Harness Brand has no brands folder. Set HARNESS_BRAND_DATA to your local brands folder, give --data, record it with harness-brand data --set FOLDER, or copy brands in with harness-brand data --install FOLDER.';
  if (!existsSync(brands)) return `There is no brands folder at ${brands}.`;
  return `${brands} holds no brand pack that passes pack check.`;
}

const names = (brand) => [brand.id, brand.name, ...(brand.aliases ?? [])].map((each) => String(each).toLowerCase());

/** The usable pack a request names by id, name or alias in any case, with its variant
 *  (the brand's default when none is named): {id, pack, brand, variant, name}, or a refusal. */
export function choose(brands, requested, variant) {
  const usable = listPacks(brands).filter((each) => !each.problems.length);
  if (!usable.length) throw new Error(missingData(brands));
  const wanted = String(requested ?? '').trim().toLowerCase();
  const found = usable.find((each) => names(each.brand).includes(wanted));
  if (!found) {
    const broken = listPacks(brands).find((each) => each.problems.length && each.brand && names(each.brand).includes(wanted));
    if (broken) throw new Error(`The ${broken.id} brand pack does not pass pack check: ${broken.problems[0]}`);
    throw new Error(`Unknown brand: ${requested ?? '(none)'}. Choose ${usable.map((each) => each.brand.name).join(', ')}.`);
  }
  const chosen = variant ?? found.brand.defaultVariant;
  if (!Object.hasOwn(found.brand.variants, chosen)) {
    throw new Error(`Unknown ${found.id} variant: ${chosen}. Choose ${Object.keys(found.brand.variants).join(', ')}.`);
  }
  return { ...found, variant: chosen, name: found.brand.name };
}

/** A pack file read as JSON. */
export const packJson = (pack, file) => JSON.parse(readFileSync(join(pack, file), 'utf8'));
