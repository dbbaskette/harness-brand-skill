// harness-brand pack: the commands that build and check what the brands folder holds.
import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { basename, dirname, join, resolve } from 'node:path';
import { parseArgs } from 'node:util';
import { buildLibrary, checkLibrary, libraryArchive } from './lib/icons/library.mjs';
import { sourceFiles } from './lib/icons/sources.mjs';
import { contactSheet } from './lib/icons/contact-sheet.mjs';
import { readZip } from './lib/zip.mjs';
import { USAGE as BRAND_USAGE, checkBrand, measure, previews, scaffold, seal, tokens } from './pack-brand.mjs';

export const USAGE = [
  '  pack icons <source>... --library ID --name NAME [--kind glyph|picture] [--fill F]',
  '             [--fill-for SOURCE=F]... [--version V] [--usage TEXT] [--source TEXT] --into FOLDER [--replace] [--json]',
  '  pack check <library or pack folder> [--json]',
  BRAND_USAGE,
].join('\n');

function share(text, what) {
  const value = Number(text);
  if (!(value > 0 && value <= 1)) throw new Error(`${what} is a share of the box, more than 0 and at most 1.`);
  return value;
}

function icons(args) {
  const { values, positionals } = parseArgs({
    args,
    allowPositionals: true,
    options: {
      library: { type: 'string' }, name: { type: 'string' }, kind: { type: 'string', default: 'glyph' },
      fill: { type: 'string', default: '1' }, 'fill-for': { type: 'string', multiple: true, default: [] },
      version: { type: 'string', default: '1' }, usage: { type: 'string' }, source: { type: 'string' }, into: { type: 'string' },
      replace: { type: 'boolean', default: false }, json: { type: 'boolean', default: false },
    },
  });
  if (!positionals.length) throw new Error('Name at least one source: an export ZIP, a folder of SVGs or an icons.json.');
  if (!values.library || !values.name || !values.into) throw new Error('Give --library, --name and --into.');
  const fills = {};
  for (const pair of values['fill-for']) {
    const at = pair.lastIndexOf('=');
    if (at < 1) throw new Error(`--fill-for takes SOURCE=F, such as design-system.zip=0.88, not ${pair}.`);
    fills[pair.slice(0, at)] = share(pair.slice(at + 1), `--fill-for ${pair}`);
  }
  const into = resolve(values.into);
  if (basename(into) !== values.library) {
    throw new Error(`The folder must be named for the library: use --into ${join(dirname(into), values.library)}.`);
  }
  const target = join(into, 'library.zip');
  if (existsSync(target) && !values.replace) throw new Error(`${into} already has a library.zip. Give --replace to make it again.`);
  const sources = positionals.map((place) => {
    if (!existsSync(place)) throw new Error(`There is no source at ${place}.`);
    return { label: basename(resolve(place)), files: sourceFiles(place) };
  });
  const labels = sources.map((each) => each.label);
  const twice = labels.find((label, n) => labels.indexOf(label) !== n);
  if (twice) throw new Error(`Two sources are both named ${twice}; give each source a different file or folder name.`);
  for (const label of Object.keys(fills)) {
    if (!labels.includes(label)) throw new Error(`--fill-for ${label} matches no source. The sources are: ${labels.join(', ')}.`);
  }
  const built = buildLibrary(sources, { id: values.library, name: values.name, kind: values.kind,
    version: values.version, usage: values.usage, source: values.source, fill: share(values.fill, '--fill'), fills });
  if (!built.icons.length) throw new Error('No icons were found in those sources. Nothing was written.');
  const archive = libraryArchive(built);
  const problems = checkLibrary(archive, { id: values.library });
  if (problems.length) throw new Error(`The library made does not pass, so nothing was written:\n${problems.join('\n')}`);
  const sheet = join(into, 'contact-sheet.svg');
  const drawn = contactSheet(built.library, built.icons, built.svgs);
  mkdirSync(into, { recursive: true });
  writeFileSync(`${target}.tmp`, archive);
  writeFileSync(`${sheet}.tmp`, drawn);
  renameSync(`${target}.tmp`, target);
  renameSync(`${sheet}.tmp`, sheet);
  if (values.json) {
    console.log(JSON.stringify({ library: target, kind: built.library.kind, icons: built.icons.length,
      sources: built.counts, skipped: built.skipped, contactSheet: sheet }, null, 2));
    return 0;
  }
  console.log(`Wrote ${target}: ${built.icons.length} ${built.library.kind} icons.`);
  for (const count of built.counts) {
    console.log(`  ${count.source}: ${count.added} added${count.already ? `, ${count.already} already in the library` : ''}`);
  }
  if (built.skipped.length) {
    console.log(`Left out ${built.skipped.length}:`);
    for (const each of built.skipped) console.log(`  ${each.source}: ${each.file}: ${each.reason}`);
  }
  console.log(`Contact sheet: ${sheet}`);
  return 0;
}

function check(args) {
  const { values, positionals } = parseArgs({ args, allowPositionals: true,
    options: { json: { type: 'boolean', default: false } } });
  if (positionals.length !== 1) throw new Error('Name one folder to check.');
  const folder = resolve(positionals[0]);
  const archive = join(folder, 'library.zip');
  if (!existsSync(archive)) {
    if (existsSync(join(folder, 'brand.json'))) return checkBrand(folder, values.json);
    throw new Error(`${folder} is neither an icon library (it has no library.zip) nor a brand pack (it has no brand.json).`);
  }
  const buffer = readFileSync(archive);
  const problems = checkLibrary(buffer, { id: basename(folder) });
  if (values.json) {
    console.log(JSON.stringify({ ok: !problems.length, problems }, null, 2));
    return problems.length ? 1 : 0;
  }
  if (problems.length) {
    console.log(`${folder} does not pass:`);
    for (const problem of problems) console.log(`  ${problem}`);
    return 1;
  }
  const { library, index } = summary(buffer);
  console.log(`${library.name} passes: ${index.icons.length} ${library.kind} icons.`);
  return 0;
}

function summary(buffer) {
  // Only called on an archive that passed checkLibrary.
  const files = readZip(buffer);
  return { library: JSON.parse(files.get('library.json').toString('utf8')),
    index: JSON.parse(files.get('icons.json').toString('utf8')) };
}

export async function main(args) {
  const [command, ...rest] = args;
  if (command === 'icons') return icons(rest);
  if (command === 'check') return check(rest);
  if (command === 'tokens') return tokens(rest);
  if (command === 'measure') return measure(rest);
  if (command === 'previews') return previews(rest);
  if (command === 'scaffold') return scaffold(rest);
  if (command === 'seal') return seal(rest);
  throw new Error(`${command ? `pack ${command} is not a pack command` : 'Name a pack command'}. Usage:\n${USAGE}`);
}
