// harness-brand brands: the brand packs in the brands folder.
import { parseArgs } from 'node:util';
import { dataFolder, listPacks, missingData } from './lib/worker/brands.mjs';

export function main(args) {
  const { values } = parseArgs({ args, options: { json: { type: 'boolean', default: false } } });
  const brands = dataFolder();
  const packs = listPacks(brands);
  const usable = packs.filter((each) => !each.problems.length);
  // The default variant first: studios take the first variant listed when a deck names none.
  const variantsOf = (brand) => [brand.defaultVariant, ...Object.keys(brand.variants).filter((each) => each !== brand.defaultVariant)];
  const listed = usable.map(({ brand }) => ({ brand: brand.id, name: brand.name, variants: variantsOf(brand),
    slides: Object.values(brand.variants).some((variant) => variant.slides) }));
  if (values.json) {
    // No usable pack is a refusal, so a studio shows why instead of taking the skill to be broken.
    if (!listed.length) {
      const broken = packs.filter((each) => each.problems.length);
      throw new Error(broken.length ? `${missingData(brands)} ${broken.map((each) => `${each.id}: ${each.problems[0]}`).join(' ')}` : missingData(brands));
    }
    console.log(JSON.stringify(listed, null, 2));
    return 0;
  }
  if (!packs.length) {
    console.log(missingData(brands));
    return 0;
  }
  for (const each of listed) console.log(`${each.brand}: ${each.name} (${each.variants.join(', ')})${each.slides ? '' : ', for writing only'}`);
  for (const each of packs.filter((pack) => pack.problems.length)) console.log(`${each.id}: not usable: ${each.problems[0]}`);
  return 0;
}
