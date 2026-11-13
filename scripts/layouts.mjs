// harness-brand layouts: a brand's template layouts and what each is for, for slide building.
import { parseArgs } from 'node:util';
import { choose, dataFolder, packJson } from './lib/worker/brands.mjs';

export function main(args) {
  const { values } = parseArgs({ args, options: { brand: { type: 'string' }, variant: { type: 'string' },
    query: { type: 'string' }, id: { type: 'string' }, relationship: { type: 'string' }, all: { type: 'boolean', default: false },
    json: { type: 'boolean', default: false } } });
  const chosen = choose(dataFolder(), values.brand, values.variant);
  if (!chosen.brand.variants[chosen.variant].slides) throw new Error(`The ${chosen.name} brand has no slides, so no layouts.`);
  const measured = packJson(chosen.pack, 'layouts.json').variants[chosen.variant];
  const words = String(values.query ?? '').toLowerCase().split(/\s+/).filter(Boolean);
  const text = (layout) => [layout.name, layout.relationship, layout.notes, ...(layout.searchTerms ?? []), ...(layout.components ?? [])]
    .filter(Boolean).join(' ').toLowerCase();
  const found = measured.layouts.filter((layout) => (values.id ? layout.id === values.id || layout.name === values.id
    : (values.all || layout.searchable !== false)
      && (!values.relationship || layout.relationship === values.relationship)
      && words.every((word) => text(layout).includes(word))))
    .map(({ id, name, rawName, part, relationship, contentRange, components, searchTerms, delivery, searchable, notes, preview, placeholders }) => ({
      id, name: rawName ?? name, part, relationship, contentRange, components, searchTerms, delivery,
      ...(searchable === false ? { searchable } : {}), notes, preview,
      placeholders: placeholders.map((each) => ({ type: each.type, idx: each.idx, bounds: each.bounds })) }));
  if (values.id && !found.length) throw new Error(`${chosen.name} ${chosen.variant} has no layout ${values.id}.`);
  if (values.json) {
    console.log(JSON.stringify({ brand: chosen.id, variant: chosen.variant, template: measured.template, layouts: found }, null, 2));
    return 0;
  }
  for (const layout of found) console.log(`${layout.name}${layout.relationship ? ` (${layout.relationship})` : ''}${layout.notes ? `: ${layout.notes}` : ''}`);
  if (!found.length) console.log('No layout matches.');
  return 0;
}
