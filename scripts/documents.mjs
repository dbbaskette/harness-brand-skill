// harness-brand documents: a brand's Word document templates and what each is for.
import { parseArgs } from 'node:util';
import { join } from 'node:path';
import { choose, dataFolder } from './lib/worker/brands.mjs';

export function main(args) {
  const { values } = parseArgs({ args, options: { brand: { type: 'string' }, id: { type: 'string' }, json: { type: 'boolean', default: false } } });
  const chosen = choose(dataFolder(), values.brand);
  const listed = (chosen.brand.documents ?? []).filter((each) => !values.id || each.id === values.id)
    .map(({ id, name, useWhen, page, file, notes }) => ({ id, name, useWhen, ...(page ? { page } : {}), ...(notes ? { notes } : {}), file, path: join(chosen.pack, file) }));
  if (values.id && !listed.length) throw new Error(`${chosen.name} has no document template ${values.id}.`);
  if (values.json) {
    console.log(JSON.stringify({ brand: chosen.id, documents: listed }, null, 2));
    return 0;
  }
  for (const each of listed) console.log(`${each.id}: ${each.name}${each.page ? ` (${each.page})` : ''}. ${each.useWhen}\n  ${each.path}`);
  if (!listed.length) console.log(`${chosen.name} has no document templates.`);
  return 0;
}
