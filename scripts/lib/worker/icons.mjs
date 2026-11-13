// Searching the icon libraries the brand packs use, and the icon deck a contract names.
import { existsSync, readFileSync } from 'node:fs';
import { basename, dirname, join } from 'node:path';
import { iconDeck, iconId, placeOf, readLibrary, DECK_VERSION } from './icon-deck.mjs';
import { listPacks, packJson } from './brands.mjs';
import { sha256 } from '../pack/check.mjs';

/** The library.zip of an icon library the brands folder holds. */
export const libraryZip = (brands, id) => join(brands, 'icon-libraries', id, 'library.zip');

/** The ids of the libraries a pack's brand searches, its default first. */
export function librariesOf(brand) {
  const entries = Array.isArray(brand.icons) ? brand.icons : [];
  return [...entries.filter((each) => each.default), ...entries.filter((each) => !each.default)].map((each) => each.library);
}

/** The colour a variant's icon discs are drawn in: its icon role's colour. */
export function discOf(pack, brand, variant) {
  const settings = brand.variants[variant];
  const role = settings.slides?.icon?.colorRole ?? 'headingPrimary';
  const tokens = packJson(pack, 'tokens.json');
  const color = tokens.colors.find((each) => each.name === settings.colors[role]);
  return String(settings.theme === 'dark' ? color.dark ?? color.light : color.light).toUpperCase();
}

/** The glyph library a brand's slides draw icons from: its first glyph library, default first. */
export function glyphLibraryOf(brands, brand) {
  return librariesOf(brand).find((id) => {
    const zip = libraryZip(brands, id);
    return existsSync(zip) && readLibrary(readFileSync(zip)).library.kind === 'glyph';
  }) ?? null;
}

/** The icon deck for a variant's glyph library, or null when it has none. */
export function deckFor(brands, chosen) {
  const library = glyphLibraryOf(brands, chosen.brand);
  if (!library) return null;
  return iconDeck(libraryZip(brands, library), { disc: discOf(chosen.pack, chosen.brand, chosen.variant) });
}

/** Make again an icon deck a contract names that is no longer there, from the pack it came from;
 *  refuse in a sentence when it cannot be made again where the contract looks for it. */
export function restoreDeck(brands, path) {
  if (existsSync(path)) return;
  const gone = new Error(`The icon deck this contract names, ${path}, is gone and cannot be made again here. Export the brand contract again.`);
  const key = basename(dirname(path));
  for (const each of listPacks(brands).filter((pack) => !pack.problems.length)) {
    const library = glyphLibraryOf(brands, each.brand);
    if (!library) continue;
    const zip = libraryZip(brands, library);
    for (const variant of Object.keys(each.brand.variants)) {
      const disc = discOf(each.pack, each.brand, variant);
      const made = sha256(Buffer.concat([readFileSync(zip), Buffer.from(`\n${disc}\n${DECK_VERSION}`)])).slice(0, 32);
      if (made === key) {
        if (iconDeck(zip, { disc }).path !== path) throw gone;
        return;
      }
    }
  }
  throw gone;
}

const wordsOf = (text) => String(text ?? '').toLowerCase().split(/[^a-z0-9]+/).filter(Boolean);

/** Icons matching every word of `query`: a word under 3 letters matches a whole word of the
 *  icon's name, category or keywords, a longer one the start of a word. */
export function searchIcons(brands, libraries, query, { limit = 8 } = {}) {
  const terms = wordsOf(query);
  if (!terms.length) throw new Error('--query needs words to search for');
  const found = [];
  for (const library of [...new Set(libraries)]) {
    const zip = libraryZip(brands, library);
    if (!existsSync(zip)) continue;
    const { library: about, icons } = readLibrary(readFileSync(zip));
    // Only glyphs are in an icon deck, so only glyph icons can be placed by id.
    if (about.kind !== 'glyph') continue;
    icons.forEach((icon, n) => {
      const words = [...wordsOf(icon.name), ...wordsOf(icon.category), ...(icon.keywords ?? []).flatMap(wordsOf), ...wordsOf(icon.slug)];
      if (!terms.every((term) => words.some((word) => (term.length < 3 ? word === term : word.startsWith(term))))) return;
      const place = placeOf(n);
      const named = wordsOf(icon.name);
      // A name made only of the words asked for comes first, then names holding them whole, then shorter names.
      const score = (named.every((word) => terms.includes(word)) ? 100 : 0) + terms.filter((term) => named.includes(term)).length * 10
        + terms.filter((term) => named.some((word) => word.startsWith(term))).length - named.length / 100;
      found.push({ score, order: found.length, result: { kind: 'icon', library: about.id, slide: place.slide, category: icon.category,
        label: icon.name, id: iconId(about.id, icon.slug), shapeIds: place.shapeIds, bounds: place.bounds, native: true, preview: null } });
    });
  }
  found.sort((a, b) => b.score - a.score || a.order - b.order);
  return { total: found.length, results: found.slice(0, limit).map((each) => each.result) };
}
