// harness-brand data: the brands folder the brand commands read, recording it for studios that
// run Harness Brand without HARNESS_BRAND_DATA, and copying brands into the local brands folder.
import { randomUUID } from 'node:crypto';
import { cpSync, existsSync, mkdirSync, readdirSync, renameSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { parseArgs } from 'node:util';
import { findData, listPacks, localFolder, pointerFile } from './lib/worker/brands.mjs';

const folderAt = (given) => {
  const folder = resolve(given);
  if (!existsSync(folder) || !statSync(folder).isDirectory()) throw new Error(`There is no folder at ${folder}.`);
  return folder;
};

/** Copy every brand folder (one with a pack/ or an apply-brand/ profile) and the icon libraries
 *  from `source` into the local brands folder, each replacing its earlier copy whole. */
function install(source) {
  const target = localFolder();
  if (resolve(source) === resolve(target)) throw new Error(`${source} is already the local brands folder.`);
  const names = readdirSync(source).filter((name) => !name.startsWith('.') && statSync(join(source, name)).isDirectory()
    && (name === 'icon-libraries' || existsSync(join(source, name, 'pack', 'brand.json')) || existsSync(join(source, name, 'apply-brand', 'brand.json'))));
  if (!names.length) throw new Error(`${source} holds no brands: no folder with a pack/ or apply-brand/ in it.`);
  mkdirSync(target, { recursive: true });
  for (const name of names) {
    const staged = join(target, `.${name}.${randomUUID()}`);
    cpSync(join(source, name), staged, { recursive: true });
    rmSync(join(target, name), { recursive: true, force: true });
    renameSync(staged, join(target, name));
  }
  return names;
}

export function main(args) {
  const { values } = parseArgs({ args, options: { set: { type: 'string' }, install: { type: 'string' }, json: { type: 'boolean', default: false } } });
  if (values.set !== undefined && values.install !== undefined) throw new Error('Give --set or --install, not both.');
  if (values.set !== undefined) {
    const folder = folderAt(values.set);
    const file = pointerFile();
    mkdirSync(dirname(file), { recursive: true });
    writeFileSync(`${file}.tmp`, `${folder}\n`);
    renameSync(`${file}.tmp`, file);
  }
  const installed = values.install !== undefined ? install(folderAt(values.install)) : undefined;
  const { folder, from } = findData();
  const packs = listPacks(folder);
  const answer = { folder, from, local: localFolder(),
    usable: packs.filter((each) => !each.problems.length).map((each) => each.id),
    unusable: packs.filter((each) => each.problems.length).map((each) => ({ brand: each.id, problem: each.problems[0] })),
    ...(installed ? { installed } : {}) };
  if (values.json) console.log(JSON.stringify(answer, null, 2));
  else {
    if (installed) console.log(`Copied ${installed.join(', ')} into ${answer.local}.`);
    if (installed && folder !== answer.local) console.log(`The brand commands still read ${folder ?? 'no folder'}, named by ${from}; the local folder is used only when nothing else names one.`);
    console.log(folder ? `${folder}: ${answer.usable.length} usable brand pack${answer.usable.length === 1 ? '' : 's'}${answer.usable.length ? ` (${answer.usable.join(', ')})` : ''}.` : 'No brands folder is set.');
  }
  return 0;
}
