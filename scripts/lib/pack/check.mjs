// Checking a brand pack against docs/brand-pack-format.md: every problem, each in a sentence.
import { createHash } from 'node:crypto';
import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import { basename, dirname, join, relative, sep } from 'node:path';
import { checkLibrary, SLUG } from '../icons/library.mjs';

export const ROLES = ['canvasPrimary', 'canvasSecondary', 'inkPrimary', 'inkDeep', 'headingPrimary', 'accentAqua'];
export const STYLES = ['title', 'body', 'bodyReference', 'label', 'caption', 'metric', 'quote'];
const TEXT_ROLES = ['inkPrimary', 'inkDeep', 'headingPrimary', 'inkSecondary'];
const VARIANT = /^[a-z][a-z0-9-]*$/;
const HEX = /^#[0-9a-f]{6}$/;
const AA = 4.5;
const LARGE = 3;   // text of 18 points, or 14 bold, needs only 3 to 1
const MOTIF = 1000;   // Harness Slides takes far more; a motif longer than this is no longer one device

export const sha256 = (data) => createHash('sha256').update(data).digest('hex');
const object = (value) => value !== null && typeof value === 'object' && !Array.isArray(value);
const text = (value) => typeof value === 'string' && value.trim() !== '';
const number = (value) => typeof value === 'number' && Number.isFinite(value);
const has = (holder, key) => object(holder) && typeof key === 'string' && Object.hasOwn(holder, key);
const list = (value) => (Array.isArray(value) ? value : []);
const PLACEHOLDER = /^Review:/m;   // what pack scaffold leaves for a person to write

/** The SHA-256 pack seal records for brand.json itself: its fields but the seal's own. */
export function brandHash(brand) {
  const { files: _files, sources: _sources, brandSha256: _sealed, ...rest } = brand;
  // Keys in sorted order, so moving a field is not a change.
  const sorted = (value) => (Array.isArray(value) ? value.map(sorted) : object(value)
    ? Object.fromEntries(Object.keys(value).sort().map((key) => [key, sorted(value[key])])) : value);
  return sha256(JSON.stringify(sorted(rest)));
}

/** The contrast of two #rrggbb colours, 1 to 21. */
export function contrast(one, two) {
  const luminance = (hex) => {
    const [r, g, b] = [1, 3, 5].map((at) => parseInt(hex.slice(at, at + 2), 16) / 255)
      .map((c) => (c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4));
    return 0.2126 * r + 0.7152 * g + 0.0722 * b;
  };
  const [light, dark] = [luminance(one), luminance(two)].sort((a, b) => b - a);
  return (light + 0.05) / (dark + 0.05);
}

/** A pack file read as JSON, or a problem. */
function readJson(pack, file, problems) {
  const place = join(pack, file);
  if (!existsSync(place)) return undefined;
  try {
    return JSON.parse(readFileSync(place, 'utf8'));
  } catch (error) {
    problems.push(`${file} is not JSON (${error.message}).`);
    return null;
  }
}

/** Every file in the pack, as paths with /, previews left out (they are drawn again). */
export function packFiles(pack) {
  const found = [];
  const walk = (folder) => {
    for (const name of readdirSync(folder).sort()) {
      if (name.startsWith('.')) continue;
      const full = join(folder, name);
      const path = relative(pack, full).split(sep).join('/');
      if (statSync(full).isDirectory()) { if (path !== 'previews') walk(full); } else if (path !== 'brand.json') found.push(path);
    }
  };
  walk(pack);
  return found;
}

/** Every source file beside the pack (brands/<id>/sources), as names. */
export function sourceFiles(pack) {
  const folder = join(dirname(pack), 'sources');
  if (!existsSync(folder)) return [];
  const found = [];
  const walk = (here) => {
    for (const name of readdirSync(here).sort()) {
      if (name.startsWith('.')) continue;
      const full = join(here, name);
      if (statSync(full).isDirectory()) walk(full); else found.push(relative(folder, full).split(sep).join('/'));
    }
  };
  walk(folder);
  return found;
}

function checkColors(name, variant, tokensByName, problems) {
  const colors = {};
  if (!object(variant.colors)) { problems.push(`Variant ${name} needs "colors": each role and the tokens.json colour that plays it.`); return colors; }
  for (const role of ROLES) if (!has(variant.colors, role)) problems.push(`Variant ${name} has no ${role} role.`);
  for (const [role, colour] of Object.entries(variant.colors)) {
    if (!tokensByName) continue;
    const token = tokensByName.get(colour);
    if (!token) { problems.push(`Variant ${name}'s ${role} names ${colour}, which tokens.json has no colour called.`); continue; }
    const value = variant.theme === 'dark' ? token.dark ?? token.light : token.light;
    if (!HEX.test(String(value ?? ''))) {
      problems.push(`Variant ${name}'s ${role} is ${colour}, whose ${variant.theme} value is not a #rrggbb colour (${value ?? 'none'}).`);
      continue;
    }
    colors[role] = value;
  }
  return colors;
}

function box(value) {
  return object(value) && ['x', 'y', 'width', 'height'].every((key) => number(value[key])) && value.width > 0 && value.height > 0;
}

function checkSlides(name, slides, declared, colors, measured, problems) {
  const where = `Variant ${name}'s slides`;
  if (slides.template !== `templates/${name}.pptx`) problems.push(`${where} need "template": "templates/${name}.pptx".`);
  if (!measured) problems.push(`${where} have no measured template: layouts.json has no variant ${name}. Run pack measure.`);
  const layoutNames = (measured?.layouts ?? []).map((layout) => layout.name);
  const named = (layout) => layoutNames.filter((each) => each === layout).length === 1;
  if (!text(slides.layout) || (measured && !named(slides.layout))) {
    problems.push(`${where} need "layout": the name of exactly one layout of the template (${slides.layout ?? 'none given'}).`);
  }
  const canvas = slides.canvas;
  if (!object(canvas) || !number(canvas.width) || !number(canvas.height) || canvas.width <= 0 || canvas.height <= 0
      || canvas.width > 2000 || canvas.height > 2000) {
    problems.push(`${where} need "canvas": a width and height in points, each from 1 to 2000.`);
  } else if (object(measured?.canvas) && (Math.abs(canvas.width - measured.canvas.width) > 1 || Math.abs(canvas.height - measured.canvas.height) > 1)) {
    problems.push(`${where}' canvas is ${canvas.width} × ${canvas.height} points, but the template measures ${measured.canvas.width} × ${measured.canvas.height}.`);
  }
  for (const key of ['titleBox', 'contentBox']) {
    const value = slides[key];
    if (!box(value)) { problems.push(`${where} need "${key}": x, y, width and height in points.`); continue; }
    if (object(canvas) && (value.x < 0 || value.y < 0 || value.x + value.width > canvas.width + 1 || value.y + value.height > canvas.height + 1)) {
      problems.push(`${where}' ${key} goes outside the canvas.`);
    }
  }
  if (slides.reservedBottom !== undefined && (!number(slides.reservedBottom)
      || (box(slides.contentBox) && slides.reservedBottom < slides.contentBox.y + slides.contentBox.height))) {
    problems.push(`${where}' reservedBottom must be a number at least the content box's bottom.`);
  }
  if (slides.spacing !== undefined && (!object(slides.spacing) || !Object.values(slides.spacing).every(number))) {
    problems.push(`${where}' spacing must give numbers in points.`);
  }
  // A role the variant names but whose colour was refused is reported once, above.
  const roleKnown = (role) => declared.has(role);
  if (!object(slides.typography)) {
    problems.push(`${where} need "typography" with ${STYLES.join(', ')}.`);
  } else {
    for (const style of STYLES) if (!slides.typography[style]) problems.push(`${where} have no ${style} type style.`);
    for (const [style, value] of Object.entries(slides.typography)) {
      if (!object(value) || !number(value.size) || value.size < 1 || value.size > 120 || typeof value.bold !== 'boolean'
          || !roleKnown(value.colorRole)) {
        problems.push(`${where}' ${style} style needs a size from 1 to 120 points, bold true or false, and a colorRole the variant has.`);
      } else if (colors.canvasPrimary && has(colors, value.colorRole) && style !== 'section') {   // a section title sits on its layout's own ground
        const needs = value.size >= 18 || (value.bold && value.size >= 14) ? LARGE : AA;
        const reaches = contrast(colors[value.colorRole], colors.canvasPrimary);
        if (reaches < needs) {
          problems.push(`${where}' ${style} text (${value.colorRole}) reaches only ${reaches.toFixed(2)} to 1 on canvasPrimary; it needs ${needs}.`);
        }
      }
    }
  }
  if (!Array.isArray(slides.chart?.seriesRoles) || !slides.chart.seriesRoles.length || !slides.chart.seriesRoles.every(roleKnown)) {
    problems.push(`${where} need chart "seriesRoles": a list of roles the variant has.`);
  }
  if (!roleKnown(slides.table?.headerFillRole) || !roleKnown(slides.table?.headerTextRole)) {
    problems.push(`${where} need table "headerFillRole" and "headerTextRole", roles the variant has.`);
  }
  if (!number(slides.icon?.size) || slides.icon.size <= 0 || !roleKnown(slides.icon?.colorRole)) {
    problems.push(`${where} need icon "size" in points and a "colorRole" the variant has.`);
  }
  for (const [part, key] of [['chart', 'gridRole'], ['image', 'frameRole'], ['image', 'calloutRole']]) {
    const role = slides[part]?.[key];
    if (role !== undefined && !roleKnown(role)) problems.push(`${where}' ${part} ${key} ${role} is not a role the variant has.`);
  }
  for (const [part, keys] of [['chart', ['axisFontPt', 'dataLabelFontPt']], ['table', ['fontPt', 'paddingPt', 'rowHeightPt']],
    ['icon', ['gapToLabel']], ['image', ['frameWidthPt', 'calloutFontPt']]]) {
    for (const key of keys) {
      const value = slides[part]?.[key];
      if (value !== undefined && (!number(value) || value < 0)) problems.push(`${where}' ${part} ${key} must be a number of points.`);
    }
  }
  if (slides.image !== undefined && (!object(slides.image) || (slides.image.fit !== undefined && !['contain', 'cover'].includes(slides.image.fit)))) {
    problems.push(`${where}' image must be an object whose fit is contain or cover.`);
  }
  if (slides.fills !== undefined && (!object(slides.fills) || (slides.fills.tints !== undefined && typeof slides.fills.tints !== 'boolean'))) {
    problems.push(`${where}' fills must say tints true or false.`);
  }
}

function checkDirections(directions, slideVariants, variantColors, variantRoles, layoutsByVariant, problems) {
  if (directions === undefined) { problems.push('The pack has slides but no directions.json.'); return; }
  if (!object(directions)) { if (directions !== null) problems.push('directions.json must be a JSON object.'); return; }
  if (directions.schema !== 1) problems.push('directions.json needs "schema": 1.');
  if (!Array.isArray(directions.house) || !directions.house.every(text)) problems.push('directions.json needs "house": a list of rules, each a sentence.');
  const ids = new Set();
  for (const name of slideVariants) {
    const variant = directions.variants?.[name];
    const where = `directions.json's variant ${name}`;
    if (!object(variant)) { problems.push(`directions.json has no variant ${name}.`); continue; }
    const colors = variantColors.get(name) ?? {};
    const names = (layoutsByVariant.get(name) ?? []).map((layout) => layout.name);
    const layout = (value) => names.filter((each) => each === value).length === 1;
    if (!Array.isArray(variant.directions) || !variant.directions.length) { problems.push(`${where} needs at least one direction.`); continue; }
    if (!text(variant.default) || !variant.directions.some((direction) => direction?.id === variant.default)) problems.push(`${where}'s default is not one of its directions.`);
    if (!object(variant.closing) || !object(variant.closing.withWords) || !layout(variant.closing.withWords.layout)) {
      problems.push(`${where} needs closing "withWords" with the name of a layout of the template.`);
    }
    if (variant.closing?.thanks !== undefined && !layout(variant.closing.thanks?.layout)) problems.push(`${where}'s closing "thanks" names no layout of the template.`);
    if (variant.reservedRoles !== undefined && !Array.isArray(variant.reservedRoles)) problems.push(`${where}'s reservedRoles must be a list of roles.`);
    const reserved = list(variant.reservedRoles);
    for (const role of reserved) if (!has(colors, role)) problems.push(`${where} reserves ${role}, which the variant does not have.`);
    for (const direction of variant.directions) {
      const label = `Direction ${direction?.id ?? '?'}`;
      if (!text(direction?.id) || !text(direction?.name) || !text(direction?.useWhen)) { problems.push(`${label} needs an id, a name and useWhen.`); continue; }
      if (ids.has(direction.id)) problems.push(`${label} repeats an id used before.`);
      ids.add(direction.id);
      const { focal, neutral, motif } = object(direction.direction) ? direction.direction : {};
      const given = direction.direction?.meanings;
      if (given !== undefined && !object(given)) problems.push(`${label}'s meanings must give each role what it stands for.`);
      const meanings = object(given) ? given : {};
      const roles = variantRoles.get(name) ?? new Set();
      if (roles.has(focal) && roles.has(neutral) && !(has(colors, focal) && has(colors, neutral))) continue;   // their colours were refused above
      if (!has(colors, focal) || !has(colors, neutral)) { problems.push(`${label} needs a focal and a neutral role the variant has.`); continue; }
      if (focal === neutral) problems.push(`${label}'s focal and neutral roles are the same.`);
      if (neutral === 'canvasPrimary') problems.push(`${label}'s neutral role cannot be canvasPrimary.`);
      if (colors.inkDeep && contrast(colors[neutral], colors.inkDeep) < AA) problems.push(`${label}'s neutral ${neutral} does not reach ${AA} to 1 against inkDeep.`);
      if (!text(motif) || motif.length > MOTIF) problems.push(`${label} needs a motif of at most ${MOTIF} characters.`);
      const seen = new Set();
      for (const role of Object.keys(meanings)) {
        if (!has(colors, role)) { problems.push(`${label} gives a meaning to ${role}, which the variant does not have.`); continue; }
        if (role === focal || role === neutral) problems.push(`${label} gives a meaning to its own focal or neutral role, ${role}.`);
        if (seen.has(colors[role])) problems.push(`${label} gives two meanings the same colour.`);
        seen.add(colors[role]);
      }
      for (const role of [focal, ...Object.keys(meanings)].filter((each) => has(colors, each))) {
        if (reserved.includes(role)) problems.push(`${label} uses the reserved role ${role}.`);
        const best = Math.max(...['onAccent', 'canvasPrimary', 'inkDeep'].filter((each) => colors[each]).map((each) => contrast(colors[role], colors[each])));
        if (best < AA) problems.push(`${label}: no text colour reaches ${AA} to 1 on ${role}.`);
      }
      for (const key of ['cover', 'section', 'closing']) if (!layout(direction.layouts?.[key])) problems.push(`${label} needs a ${key} layout of the template.`);
      if (direction.layouts?.thanks !== undefined && !layout(direction.layouts.thanks)) problems.push(`${label}'s thanks layout is not a layout of the template.`);
      for (const key of ['cues', 'keys']) if (direction[key] !== undefined && !object(direction[key])) problems.push(`${label}'s ${key} must give them by role.`);
      for (const role of Object.keys(object(direction.cues) ? direction.cues : {})) if (!has(meanings, role)) problems.push(`${label} gives cues for ${role}, which has no meaning.`);
      for (const role of Object.keys(object(direction.keys) ? direction.keys : {})) if (!has(meanings, role)) problems.push(`${label} gives a key for ${role}, which has no meaning.`);
    }
  }
}

function checkAudit(audit, problems) {
  if (audit === undefined) { problems.push('The pack has slides but no audit.json.'); return; }
  if (!object(audit)) { if (audit !== null) problems.push('audit.json must be a JSON object.'); return; }
  if (audit.schema !== 1) problems.push('audit.json needs "schema": 1.');
  for (const key of ['minTextPt', 'maxWords', 'textLedWords', 'overlapRatio', 'outOfBoundsInches']) {
    if (audit[key] !== undefined && (!number(audit[key]) || audit[key] < 0)) problems.push(`audit.json's ${key} must be a number, 0 or more.`);
  }
  for (const key of ['contrast', 'tolerances', 'consistency']) {
    if (audit[key] !== undefined && (!object(audit[key]) || !Object.values(audit[key]).every(number))) problems.push(`audit.json's ${key} must give numbers.`);
  }
  for (const key of ['fonts', 'starterText']) {
    if (audit[key] !== undefined && (!Array.isArray(audit[key]) || !audit[key].every(text))) problems.push(`audit.json's ${key} must be a list of words.`);
  }
}

/** Every problem with the pack in `pack` (brands/<id>/pack), each in a sentence; none means it
 *  passes. `hashes: false` leaves out the files and sources sealed in brand.json. */
export function checkPack(pack, { hashes = true } = {}) {
  const problems = [];
  const brand = readJson(pack, 'brand.json', problems);
  if (brand === undefined) return [`${pack} has no brand.json.`];
  if (!object(brand)) return problems.length ? problems : ['brand.json must be a JSON object.'];
  const tokens = readJson(pack, 'tokens.json', problems);
  const layouts = readJson(pack, 'layouts.json', problems);
  if (brand.schema !== 1) problems.push('brand.json needs "schema": 1.');
  if (brand.draft !== undefined) {
    const left = list(brand.draft).filter(text);
    problems.push(`brand.json is still a draft: ${left.length ? left.join(' ') : 'remove "draft" once it is reviewed.'}`);
  }
  if (!text(brand.id) || !SLUG.test(brand.id) || brand.id === 'icon-libraries') {
    problems.push('brand.json needs an "id" of lower-case letters, digits and hyphens.');
  } else if (basename(pack) === 'pack' && basename(dirname(pack)) !== brand.id) {
    problems.push(`brand.json says its id is ${brand.id}, but its folder is ${basename(dirname(pack))}.`);
  }
  if (!text(brand.name)) problems.push('brand.json needs a "name".');
  if (!Array.isArray(brand.aliases) || !brand.aliases.length || !brand.aliases.every((alias) => text(alias) && alias === alias.toLowerCase())) {
    problems.push('brand.json needs "aliases": the words a request may use for the brand, in lower case.');
  }
  for (const key of ['sans', 'mono']) {
    const font = brand.fonts?.[key];
    if ((key === 'sans' || font !== undefined) && (!text(font) || font.includes(','))) {
      problems.push(`brand.json's fonts.${key} must be one font name, such as Arial.`);
    }
  }
  if (tokens === undefined) problems.push('The pack has no tokens.json.');
  else if (tokens !== null || !problems.some((problem) => problem.startsWith('tokens.json is not JSON'))) {
    if (!object(tokens) || tokens.schema !== 1 || !Array.isArray(tokens.colors)) problems.push('tokens.json needs "schema": 1 and a list of colors.');
  }
  // Without a usable tokens.json, the roles' colours cannot be looked up, and that is said once above.
  const tokensByName = Array.isArray(tokens?.colors) ? new Map(tokens.colors.filter(object).map((color) => [color.name, color])) : null;
  if (layouts && !(object(layouts) && layouts.schema === 1 && object(layouts.variants))) {
    problems.push('layouts.json needs "schema": 1 and variants.');
  } else if (layouts) {
    for (const [name, measured] of Object.entries(layouts.variants)) {
      if (!object(measured) || !Array.isArray(measured.layouts) || !measured.layouts.every(object) || !Array.isArray(measured.slides)
          || measured.template !== `templates/${name}.pptx`) {
        problems.push(`layouts.json's variant ${name} needs "template": "templates/${name}.pptx", a list of layouts and a list of slides. Measure it again with pack measure.`);
        delete layouts.variants[name];
      } else if (!has(brand.variants, name)) {
        problems.push(`layouts.json measures a variant ${name}, which brand.json does not have.`);
      }
    }
  }
  const variants = object(brand.variants) ? Object.entries(brand.variants) : [];
  if (!variants.length) problems.push('brand.json needs "variants", at least one.');
  if (brand.variants !== undefined && !object(brand.variants)) problems.push('brand.json\'s variants must give each variant by name.');
  if (!has(brand.variants, brand.defaultVariant)) problems.push('brand.json\'s defaultVariant is not one of its variants.');
  const variantColors = new Map();
  const variantRoles = new Map();   // the roles each variant names, whether or not their colours passed
  const layoutsByVariant = new Map();
  const slideVariants = [];
  for (const [name, variant] of variants) {
    if (!VARIANT.test(name)) problems.push(`The variant ${name} must be lower-case letters, digits and hyphens, starting with a letter.`);
    if (!object(variant)) { problems.push(`Variant ${name} must be a JSON object.`); continue; }
    if (!['light', 'dark'].includes(variant.theme)) problems.push(`Variant ${name} needs "theme": light or dark.`);
    const colors = checkColors(name, variant, tokensByName, problems);
    const declared = new Set(object(variant.colors) ? Object.keys(variant.colors) : []);
    variantRoles.set(name, declared);
    variantColors.set(name, colors);
    if (colors.canvasPrimary) {
      for (const role of TEXT_ROLES) {
        if (colors[role] && contrast(colors[role], colors.canvasPrimary) < AA) {
          problems.push(`Variant ${name}'s ${role} reaches only ${contrast(colors[role], colors.canvasPrimary).toFixed(2)} to 1 on canvasPrimary; it needs ${AA}.`);
        }
      }
    }
    if (variant.slides !== undefined) {
      slideVariants.push(name);
      const measured = layouts?.variants?.[name];
      layoutsByVariant.set(name, Array.isArray(measured?.layouts) ? measured.layouts : []);
      if (!object(variant.slides)) problems.push(`Variant ${name}'s slides must be a JSON object.`);
      else checkSlides(name, variant.slides, declared, colors, measured, problems);
      const template = join(pack, 'templates', `${name}.pptx`);
      if (!existsSync(template)) problems.push(`The pack has no templates/${name}.pptx.`);
      else if (measured && measured.sha256 !== sha256(readFileSync(template))) {
        problems.push(`templates/${name}.pptx has changed since it was measured. Run pack measure again.`);
      }
    }
  }
  for (const [i, entry] of (Array.isArray(brand.icons) ? brand.icons : []).entries()) {
    const id = entry?.library;
    const folder = join(dirname(dirname(pack)), 'icon-libraries', String(id ?? ''));
    if (!text(id) || !existsSync(join(folder, 'library.zip'))) { problems.push(`Icon library ${i + 1} (${id ?? 'none'}) is not in brands/icon-libraries/.`); continue; }
    const wrong = checkLibrary(readFileSync(join(folder, 'library.zip')), { id });
    if (wrong.length) problems.push(`The icon library ${id} does not pass its check: ${wrong[0]}`);
    if (entry.roles !== undefined && !Array.isArray(entry.roles)) problems.push(`Icon library ${id}'s roles must be a list of roles.`);
    for (const role of list(entry.roles)) {
      for (const [name, roles] of variantRoles) if (!roles.has(role)) problems.push(`Icon library ${id}'s role ${role} is not a role of variant ${name}.`);
    }
  }
  if (brand.icons !== undefined && !Array.isArray(brand.icons)) problems.push('brand.json\'s icons must be a list.');
  for (const key of ['onLight', 'onDark']) {
    const logo = brand.logos?.[key];
    if (!text(logo) || !logo.startsWith('assets/') || logo.split('/').includes('..') || !existsSync(join(pack, logo))) {
      problems.push(`brand.json's logos.${key} must name a logo file in the pack's assets/ folder.`);
    }
  }
  const language = brand.language;
  if (language !== undefined && (!object(language) || (language.headlineCase !== undefined && !['sentence', 'title'].includes(language.headlineCase))
      || (language.preserveProductNamesAndAcronyms !== undefined && typeof language.preserveProductNamesAndAcronyms !== 'boolean')
      || (language.names !== undefined && !(Array.isArray(language.names) && language.names.every(text))))) {
    problems.push('brand.json\'s language needs headlineCase sentence or title, preserveProductNamesAndAcronyms true or false, and names as sentences.');
  }
  if (brand.visual !== undefined && !object(brand.visual)) problems.push('brand.json\'s visual must be a JSON object.');
  const guide = join(pack, 'guide.md');
  if (!existsSync(guide)) {
    problems.push('The pack has no guide.md.');
  } else {
    const written = readFileSync(guide, 'utf8');
    for (const heading of ['Brand rules', 'Voice and naming', ...(slideVariants.length ? ['Slides'] : [])]) {
      if (!new RegExp(`^## ${heading}\\s*$`, 'm').test(written)) problems.push(`guide.md has no "## ${heading}" section.`);
    }
    if (PLACEHOLDER.test(written)) problems.push('guide.md still has text pack scaffold left to be written (a line starting "Review:").');
  }
  if (slideVariants.length) {
    checkDirections(readJson(pack, 'directions.json', problems), slideVariants, variantColors, variantRoles, layoutsByVariant, problems);
    if (existsSync(join(pack, 'directions.json')) && /"Review:/.test(readFileSync(join(pack, 'directions.json'), 'utf8'))) {
      problems.push('directions.json still has text pack scaffold left to be written (starting "Review:").');
    }
    checkAudit(readJson(pack, 'audit.json', problems), problems);
  }
  if (hashes) checkSeal(pack, brand, problems);
  return problems;
}

const HASH = /^[0-9a-f]{64}$/;

/** What changed since the pack was sealed: brand.json, a pack file or a source changed, went
 *  or was added. A pack never sealed has nothing to compare. */
function checkSeal(pack, brand, problems) {
  const sealed = ['files', 'sources', 'brandSha256'].some((key) => brand[key] !== undefined);
  if (!sealed) return;
  const maps = {};
  for (const key of ['files', 'sources']) {
    const map = brand[key];
    if (!object(map) || !Object.entries(map).every(([file, hash]) => text(file) && !file.split('/').includes('..')
        && !file.startsWith('/') && HASH.test(String(hash)))) {
      problems.push(`brand.json's ${key} must give each file, a path inside the ${key === 'files' ? 'pack' : 'sources folder'}, with its SHA-256 in hex. Seal the pack again.`);
      return;
    }
    maps[key] = map;
  }
  if (brand.brandSha256 !== brandHash(brand)) problems.push('brand.json has changed since the pack was sealed. Seal it again.');
  const compare = (map, folder, found, what) => {
    for (const [file, hash] of Object.entries(map)) {
      const place = join(folder, file);
      if (!existsSync(place)) problems.push(`${what(file)} was sealed in brand.json but is gone. Seal it again.`);
      else if (sha256(readFileSync(place)) !== hash) problems.push(`${what(file)} has changed since the pack was sealed. Seal it again.`);
    }
    for (const file of found) if (!Object.hasOwn(map, file)) problems.push(`${what(file)} was added since the pack was sealed. Seal it again.`);
  };
  compare(maps.files, pack, packFiles(pack), (file) => file);
  compare(maps.sources, join(dirname(pack), 'sources'), sourceFiles(pack), (file) => `The source ${file}`);
}
