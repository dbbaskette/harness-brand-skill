// harness-brand icons: search the brand's icon libraries for icons Harness Slides can place.
import { parseArgs } from 'node:util';
import { choose, dataFolder, listPacks, missingData } from './lib/worker/brands.mjs';
import { glyphLibraryOf, searchIcons } from './lib/worker/icons.mjs';

export const USAGE = 'Usage: harness-brand icons --query WORDS [--brand B [--variant V]] [--limit 1-20] [--json]';

export function main(args) {
  let values;
  try {
    ({ values } = parseArgs({ args, options: { query: { type: 'string' }, brand: { type: 'string' }, variant: { type: 'string' },
      limit: { type: 'string', default: '8' }, json: { type: 'boolean', default: false }, 'no-previews': { type: 'boolean', default: false } } }));
  } catch (error) {
    throw Object.assign(new Error(`${error.message}\n${USAGE}`), { exitCode: 2 });
  }
  const limit = Number(values.limit);
  if (!Number.isInteger(limit) || limit < 1 || limit > 20) throw Object.assign(new Error(`--limit must be an integer from 1 to 20\n${USAGE}`), { exitCode: 2 });
  if (!String(values.query ?? '').trim()) throw Object.assign(new Error(`--query needs words to search for\n${USAGE}`), { exitCode: 2 });
  const brands = dataFolder();
  let libraries;
  if (values.brand) {
    // Only the library the brand's contract carries, so every id found is in its icon deck.
    libraries = [glyphLibraryOf(brands, choose(brands, values.brand, values.variant).brand)].filter(Boolean);
  } else {
    // Without a brand, the libraries every usable pack searches: the ids are the same in each brand's deck.
    const usable = listPacks(brands).filter((each) => !each.problems.length);
    if (!usable.length) throw new Error(missingData(brands));
    libraries = usable.map((each) => glyphLibraryOf(brands, each.brand)).filter(Boolean);
  }
  const { total, results } = searchIcons(brands, libraries, values.query, { limit });
  const answer = { query: values.query, source: [...new Set(libraries)].join(', '), totalMatches: total, truncated: total > results.length, results,
    guidance: 'Place an icon by its id in a composition ({type: "icon", icon: "<id>"}); the slide engine copies it from the brand contract\'s icon deck as native shapes. One icon, one meaning.' };
  if (values.json) {
    console.log(JSON.stringify(answer, null, 2));
    return 0;
  }
  for (const each of results) console.log(`${each.id}  ${each.label} (${each.category})`);
  if (!results.length) console.log('No icon matches.');
  return 0;
}
