// harness-brand pack tokens | measure | previews | scaffold | seal, and pack check for a brand
// pack: the commands that make a brand pack from its sources and check it.
import { existsSync, mkdirSync, readFileSync, renameSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { basename, dirname, join, resolve } from 'node:path';
import { parseArgs } from 'node:util';
import { sourceFiles } from './lib/icons/sources.mjs';
import { readTokens } from './lib/pack/tokens.mjs';
import { lostLayouts, measureTemplate, mergeLayouts } from './lib/pack/measure.mjs';
import { drawPreviews, libreOfficeRenderer } from './lib/pack/previews.mjs';
import { checkPack } from './lib/pack/check.mjs';
import { scaffoldPack } from './lib/pack/scaffold.mjs';
import { sealPack } from './lib/pack/seal.mjs';
import { readLayouts } from './lib/pack/layouts-file.mjs';
import { readableJson } from './lib/readable-json.mjs';

export const USAGE = [
  '  pack tokens <export> --into PACK [--replace] [--json]',
  '  pack measure <template.pptx> --variant V --into PACK [--master N] [--replace] [--json]',
  '  pack previews <pack> --variant V [--soffice PATH] [--pdftoppm PATH] [--pdfinfo PATH] [--json]',
  '  pack scaffold <pack> [--id ID] [--name NAME] [--icons ID,...] [--replace] [--json]',
  '  pack seal <pack> [--json]',
].join('\n');

const json = (value) => `${JSON.stringify(value, null, 2)}\n`;   // for --json output

const plural = (count, word) => `${count} ${word}${count === 1 ? '' : 's'}`;

/** Write files all at once: every file is written beside itself first, and only when all
 *  are written are they put in place, so a failed write changes nothing. */
function putAll(files) {
  const written = [];
  try {
    for (const [file, data] of files) {
      mkdirSync(dirname(file), { recursive: true });
      writeFileSync(`${file}.tmp`, data);
      written.push(file);
    }
    for (const file of written) renameSync(`${file}.tmp`, file);
  } finally {
    for (const file of written) rmSync(`${file}.tmp`, { force: true });
  }
}

/** A library's "It has no ..." sentence, saying which file it is about. */
function about(place, error) {
  if (!/^Its? /.test(error.message)) return error;
  return new Error(`${basename(place)}: ${error.message[0].toLowerCase()}${error.message.slice(1)}`);
}

export function tokens(args) {
  const { values, positionals } = parseArgs({ args, allowPositionals: true, options: {
    into: { type: 'string' }, replace: { type: 'boolean', default: false }, json: { type: 'boolean', default: false } } });
  if (positionals.length !== 1) throw new Error('Name one design-system export: a ZIP archive, a folder or a tokens.json.');
  if (!values.into) throw new Error('Give --into, the pack folder.');
  const into = resolve(values.into);
  const target = join(into, 'tokens.json');
  if (existsSync(target) && !values.replace) throw new Error(`${into} already has a tokens.json. Give --replace to make it again.`);
  if (!existsSync(positionals[0])) throw new Error(`There is no export at ${positionals[0]}.`);
  let made;
  try {
    made = readTokens(sourceFiles(positionals[0]));
  } catch (error) {
    throw about(positionals[0], error);
  }
  putAll([[target, readableJson(made)]]);
  const dark = made.colors.filter((color) => color.dark).length;
  if (values.json) {
    console.log(json({ tokens: target, colors: made.colors.length, dark, styles: made.type.styles.length,
      spacing: made.spacing.length, radius: made.radius.length }).trimEnd());
    return 0;
  }
  console.log(`Wrote ${target}: ${made.colors.length} colours (${dark} with a dark value), `
    + `${made.type.styles.length} type styles, ${made.spacing.length} spacing and ${made.radius.length} radius tokens.`);
  return 0;
}

export function measure(args) {
  const { values, positionals } = parseArgs({ args, allowPositionals: true, options: {
    variant: { type: 'string' }, into: { type: 'string' }, master: { type: 'string' },
    replace: { type: 'boolean', default: false }, json: { type: 'boolean', default: false } } });
  if (positionals.length !== 1) throw new Error('Name one PowerPoint template.');
  if (!values.variant || !values.into) throw new Error('Give --variant and --into.');
  if (!existsSync(positionals[0])) throw new Error(`There is no template at ${positionals[0]}.`);
  if (statSync(positionals[0]).isDirectory()) throw new Error(`${positionals[0]} is a folder, not a PowerPoint template.`);
  const into = resolve(values.into);
  const buffer = readFileSync(positionals[0]);
  let measured;
  try {
    measured = measureTemplate(buffer, { variant: values.variant, master: values.master });
  } catch (error) {
    throw about(positionals[0], error);
  }
  const template = join(into, measured.template);
  if (existsSync(template) && !values.replace) {
    throw new Error(`${into} already has ${measured.template}. Give --replace to measure it again.`);
  }
  const index = join(into, 'layouts.json');
  const previous = existsSync(index) ? readLayouts(index) : null;
  const lost = lostLayouts(previous, values.variant, measured);
  const layouts = mergeLayouts(previous, values.variant, measured);
  putAll([[template, buffer], [index, readableJson(layouts)]]);
  const used = measured.layouts.filter((layout) => layout.used).length;
  const hidden = measured.slides.filter((slide) => slide.hidden).length;
  const others = measured.masters.filter((master) => master.part !== measured.master);
  if (values.json) {
    console.log(json({ layouts: index, template, variant: values.variant, canvas: measured.canvas, master: measured.master,
      chosenBy: measured.chosenBy, measured: measured.layouts.length, used, slides: measured.slides.length, hidden,
      otherMasters: others, lost }).trimEnd());
    return 0;
  }
  const chosen = measured.masters.find((master) => master.part === measured.master);
  console.log(`Measured ${basename(positionals[0])} as ${values.variant}: ${measured.canvas.width} × ${measured.canvas.height} pt, `
    + `master ${chosen.number}, ${plural(measured.layouts.length, 'layout')} (${used} with an example slide), `
    + `${plural(measured.slides.length, 'slide')}${hidden ? ` (${hidden} hidden)` : ''}.`);
  if (measured.chosenBy === 'first') {
    console.log(`  No visible slide uses any of its ${measured.masters.length} masters, so the first was measured. Give --master to choose another.`);
  } else if (others.length) {
    console.log(`  Not measured: ${others.map((master) => `master ${master.number} (${plural(master.layouts, 'layout')}, `
      + `${master.slides ? plural(master.slides, 'slide') : 'no slides'})`).join(', ')}. Give --master to choose another.`);
  }
  if (lost.length) {
    console.log(`  No longer found, so what was added to them is not kept: ${
      lost.map((layout) => `${layout.name} (${layout.fields.join(', ')})`).join('; ')}.`);
  }
  console.log(`Wrote ${template} and ${index}.`);
  return 0;
}

export function previews(args) {
  const { values, positionals } = parseArgs({ args, allowPositionals: true, options: {
    variant: { type: 'string' }, soffice: { type: 'string' }, pdftoppm: { type: 'string' }, pdfinfo: { type: 'string' },
    json: { type: 'boolean', default: false } } });
  if (positionals.length !== 1) throw new Error('Name one pack folder.');
  if (!values.variant) throw new Error('Give --variant.');
  const pack = resolve(positionals[0]);
  const render = libreOfficeRenderer({ soffice: values.soffice, pdftoppm: values.pdftoppm, pdfinfo: values.pdfinfo });
  const { drawn, without } = drawPreviews(pack, values.variant, render);
  if (values.json) {
    console.log(json({ previews: join(pack, 'previews', values.variant), drawn, without }).trimEnd());
    return 0;
  }
  console.log(`Drew ${plural(drawn, 'layout preview')} in ${join(pack, 'previews', values.variant)}.`
    + `${without ? ` ${plural(without, 'layout')} ${without === 1 ? 'has' : 'have'} no example slide, so no preview.` : ''}`);
  return 0;
}

/** The pack's JSON file, read for a command, or a refusal naming it. */
function readPackJson(pack, file) {
  try {
    return JSON.parse(readFileSync(join(pack, file), 'utf8'));
  } catch (error) {
    throw new Error(`${join(pack, file)} cannot be read as JSON (${error.message}).`);
  }
}

export function scaffold(args) {
  const { values, positionals } = parseArgs({ args, allowPositionals: true, options: {
    id: { type: 'string' }, name: { type: 'string' }, icons: { type: 'string' },
    replace: { type: 'boolean', default: false }, json: { type: 'boolean', default: false } } });
  if (positionals.length !== 1) throw new Error('Name one pack folder.');
  const pack = resolve(positionals[0]);
  if (!existsSync(join(pack, 'tokens.json'))) throw new Error(`${pack} has no tokens.json. Make it first with pack tokens.`);
  const tokensFile = readPackJson(pack, 'tokens.json');
  const layouts = existsSync(join(pack, 'layouts.json')) ? readLayouts(join(pack, 'layouts.json')) : null;
  const id = values.id ?? (basename(pack) === 'pack' ? basename(dirname(pack)) : basename(pack));
  const name = values.name ?? tokensFile.name;
  if (!name) throw new Error('tokens.json gives no name for the brand. Give --name.');
  const made = scaffoldPack({ id, name, tokens: tokensFile, layouts,
    icons: (values.icons ?? '').split(',').map((each) => each.trim()).filter(Boolean) });
  const files = [['brand.json', readableJson(made.brand)], ['guide.md', made.guide]];
  if (made.directions) files.push(['directions.json', readableJson(made.directions)], ['audit.json', readableJson(made.audit)]);
  const there = files.map(([file]) => file).filter((file) => existsSync(join(pack, file)));
  if (there.length && !values.replace) throw new Error(`${pack} already has ${there.join(', ')}. Give --replace to draft them again.`);
  putAll(files.map(([file, data]) => [join(pack, file), data]));
  if (values.json) {
    console.log(json({ pack, written: files.map(([file]) => file), draft: made.draft }).trimEnd());
    return 0;
  }
  console.log(`Drafted ${files.map(([file]) => file).join(', ')} in ${pack}. pack check refuses them until they are reviewed:`);
  for (const line of made.draft) console.log(`  ${line}`);
  console.log('Then remove "draft" from brand.json.');
  return 0;
}

export function seal(args) {
  const { values, positionals } = parseArgs({ args, allowPositionals: true, options: {
    json: { type: 'boolean', default: false } } });
  if (positionals.length !== 1) throw new Error('Name one pack folder.');
  const pack = resolve(positionals[0]);
  if (!existsSync(join(pack, 'brand.json'))) throw new Error(`${pack} has no brand.json.`);
  const sealed = sealPack(pack);
  putAll([[join(pack, 'brand.json'), readableJson(sealed)]]);
  const files = Object.keys(sealed.files).length;
  const sources = Object.keys(sealed.sources).length;
  if (values.json) {
    console.log(json({ brand: join(pack, 'brand.json'), files, sources }).trimEnd());
    return 0;
  }
  console.log(`Sealed ${plural(files, 'pack file')} and ${plural(sources, 'source')} in ${join(pack, 'brand.json')}.`);
  return 0;
}

/** pack check on a brand pack: every problem, each in a sentence. */
export function checkBrand(pack, asJson) {
  const problems = checkPack(pack);
  if (asJson) {
    console.log(json({ ok: !problems.length, problems }).trimEnd());
    return problems.length ? 1 : 0;
  }
  if (problems.length) {
    console.log(`${pack} does not pass:`);
    for (const problem of problems) console.log(`  ${problem}`);
    return 1;
  }
  const brand = readPackJson(pack, 'brand.json');
  const variants = Object.values(brand.variants);
  const slides = variants.filter((variant) => variant.slides).length;
  console.log(`${brand.name} passes: ${plural(variants.length, 'variant')}, ${slides} with slides`
    + `${brand.files ? '; sealed' : '; not sealed yet'}.`);
  return 0;
}
