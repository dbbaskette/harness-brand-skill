// An icon library: built from sources, kept as library.zip, and checked.
import { readZip, writeZip } from '../zip.mjs';
import { parsePath } from '../svg-path.mjs';
import { readSource, slugOf, titleOf } from './sources.mjs';
import { convertSvg } from './svg-glyph.mjs';

export const SLUG = /^[a-z0-9][a-z0-9-]*$/;
export const KINDS = ['glyph', 'picture'];

const words = (text) => String(text).toLowerCase().replace(/&/g, ' and ').split(/[^a-z0-9]+/).filter(Boolean);

/** Text as a person reads it, with compatibility forms (such as the "fi" ligature) written out. */
const tidy = (text) => String(text ?? '').normalize('NFKC').trim();

const UNSAFE = /<script\b|<foreignObject\b|\son[a-z]+\s*=|javascript:/i;   // what a picture may not hold

/** The first source's category that `name` plainly means, else `name` itself. */
export function alignCategory(name, known) {
  const exact = known.find((category) => words(category).join(' ') === words(name).join(' '));
  if (exact) return exact;
  const mine = new Set(words(name));
  const fits = known.filter((category) => {
    const last = words(category.split('/').pop());
    const lastSet = new Set(last);
    return last.every((word) => mine.has(word)) || [...mine].every((word) => lastSet.has(word));
  });
  return fits.length === 1 ? fits[0] : name;
}

/** An index entry's paths: its "paths" list, or its one "d" (as Broadcom's export writes it). */
export const pathsOf = (icon) => (Array.isArray(icon?.paths) ? icon.paths
  : typeof icon?.d === 'string' ? [icon.d] : null);

/** Why a glyph is not usable, as the end of a sentence, or null. */
export function glyphProblem(icon) {
  const paths = icon?.paths;
  if (!Array.isArray(paths) || !paths.length || paths.some((d) => typeof d !== 'string' || !d.trim())) {
    return 'needs "paths": a list of path data';
  }
  for (const d of paths) {
    try { parsePath(d); } catch { return 'has a path in "paths" that cannot be read'; }
  }
  const box = icon.bounds;
  if (!Array.isArray(box) || box.length !== 4 || !box.every(Number.isFinite)
      || box.some((n) => n < -1 || n > 101) || box[0] >= box[2] || box[1] >= box[3]) {
    return 'needs "bounds" of four numbers: a box inside the 0 to 100 box';
  }
  return null;
}

/** `base`, or `base-2`, `base-3` ... : the first that is a usable slug and not taken. */
function freeSlug(base, isTaken) {
  if (SLUG.test(base) && !isTaken(base)) return base;
  let n = 2;
  while (isTaken(`${base}-${n}`)) n += 1;
  return `${base}-${n}`;
}

/** Build a library from sources ([{label, files}]), the first source winning where slugs meet.
 *  Returns {library, icons, svgs, counts, skipped}; nothing is written. */
export function buildLibrary(sources, { id, name, kind = 'glyph', version = '1', usage, source,
  fill = 1, fills = {} }) {
  if (!SLUG.test(String(id))) throw new Error('A library id is lower-case letters, digits and hyphens.');
  if (!String(name ?? '').trim()) throw new Error('A library needs a name.');
  if (!KINDS.includes(kind)) throw new Error('A library is a glyph library or a picture library.');
  const icons = [];
  const svgs = new Map();
  const taken = new Map();
  const counts = [];
  const skipped = [];
  let note = '';
  for (const { label, files } of sources) {
    let held;
    try {
      held = readSource(files);
    } catch (error) {
      throw new Error(`${label}: ${error.message}`);
    }
    const known = [...new Set(icons.map((icon) => icon.category))];
    const count = { source: label, added: 0, already: 0 };
    if (held.kind === 'index') {
      if (kind === 'picture') throw new Error(`${label} holds glyph shapes; a picture library takes SVG drawings.`);
      note ||= held.note;
      // Every slug this index gives, so a renamed repeat never takes one a later icon owns.
      const owned = new Set(held.icons.map((raw) => String(raw?.slug ?? '')).filter((each) => SLUG.test(each)));
      const here = new Map();   // slug to its paths, for this index
      for (const raw of held.icons) {
        const given = String(raw?.slug ?? '');
        const written = String(raw?.name ?? '');
        const name = tidy(written) || titleOf(given);
        // An export that dropped a ligature from a slug ("certi-ed" for "certiﬁed") gets the
        // slug from its name written out.
        let slug = written !== written.normalize('NFKC') && slugOf(name) ? slugOf(name) : given;
        const paths = pathsOf(raw);
        const problem = !SLUG.test(slug) ? 'needs a slug of lower-case letters, digits and hyphens'
          : glyphProblem({ paths, bounds: raw?.bounds });
        if (problem) { skipped.push({ source: label, file: given || '?', reason: `it ${problem}` }); continue; }
        if (here.has(slug)) {
          // One slug twice in one index: the same drawing again is dropped; another is renamed.
          if (here.get(slug) === JSON.stringify(paths)) continue;
          slug = freeSlug(slugOf(name) || slug, (each) => here.has(each) || taken.has(each) || owned.has(each));
        }
        here.set(slug, JSON.stringify(paths));
        if (taken.has(slug)) { count.already += 1; continue; }
        const keywords = Array.isArray(raw.keywords)
          ? raw.keywords.filter((word) => typeof word === 'string' && word.trim()).map(tidy) : [];
        icons.push({ slug, name, category: alignCategory(tidy(raw.category) || 'General', known),
          ...(keywords.length ? { keywords } : {}), bounds: raw.bounds, paths });
        taken.set(slug, label);
        count.added += 1;
      }
    } else {
      const share = fills[label] ?? fill;
      const ownedHere = new Set(held.drawings.map((drawing) => drawing.slug));
      for (const drawing of held.drawings) {
        let slug = drawing.slug;
        if (!SLUG.test(slug)) {
          skipped.push({ source: label, file: drawing.path, reason: 'its file name gives no usable id' });
          continue;
        }
        if (taken.has(slug)) {
          if (taken.get(slug) !== label) { count.already += 1; continue; }
          slug = freeSlug(slug, (each) => taken.has(each) || ownedHere.has(each));
        }
        const category = alignCategory(tidy(drawing.category) || 'General', known);
        const file = `svg/${slugOf(category) || 'general'}/${slug}.svg`;
        let icon = { slug, name: tidy(drawing.name) || titleOf(slug), category };
        if (kind === 'glyph') {
          const converted = convertSvg(drawing.text, { fill: share });
          if (converted.skip) { skipped.push({ source: label, file: drawing.path, reason: converted.skip }); continue; }
          icon = { ...icon, bounds: converted.bounds, paths: converted.paths };
        } else {
          if (UNSAFE.test(drawing.text)) { skipped.push({ source: label, file: drawing.path, reason: 'its drawing has a script in it' }); continue; }
          icon = { ...icon, file };
        }
        icons.push(icon);
        if (kind === 'picture') svgs.set(file, drawing.text);
        taken.set(slug, label);
        count.added += 1;
      }
    }
    counts.push(count);
  }
  const library = { schema: 1, id, name: String(name).trim(), version: String(version), kind,
    source: source ?? sources.map((each) => each.label).join(', '), usage: usage ?? note };
  return { library, icons, svgs, counts, skipped };
}

const json = (value) => `${JSON.stringify(value, null, 2)}\n`;

/** library.zip for a build: library.json, icons.json, then the drawings by path. */
export function libraryArchive({ library, icons, svgs }) {
  const entries = [['library.json', json(library)], ['icons.json', json({ schema: 1, icons })]];
  for (const file of [...svgs.keys()].sort()) entries.push([file, svgs.get(file)]);
  return writeZip(entries);
}

/** Every problem with a library.zip, each in a sentence; none means it passes. */
export function checkLibrary(archive, { id } = {}) {
  let files;
  try {
    files = readZip(archive);
  } catch (error) {
    return [`library.zip cannot be read: ${error.message}`];
  }
  const problems = [];
  const read = (name) => {
    const data = files.get(name);
    if (!data) { problems.push(`library.zip has no ${name}.`); return null; }
    let value;
    try { value = JSON.parse(data.toString('utf8')); } catch (error) {
      problems.push(`${name} is not JSON (${error.message}).`);
      return null;
    }
    if (!value || typeof value !== 'object' || Array.isArray(value)) {
      problems.push(`${name} must be a JSON object.`);
      return null;
    }
    return value;
  };
  const library = read('library.json');
  const index = read('icons.json');
  if (library) {
    if (library.schema !== 1) problems.push('library.json needs "schema": 1.');
    if (typeof library.id !== 'string' || !SLUG.test(library.id)) {
      problems.push('library.json needs an "id" of lower-case letters, digits and hyphens.');
    } else if (id && library.id !== id) {
      problems.push(`library.json says its id is ${library.id}, but its folder is ${id}.`);
    }
    if (typeof library.name !== 'string' || !library.name.trim()) problems.push('library.json needs a "name".');
    if (typeof library.version !== 'string' || !library.version.trim()) problems.push('library.json needs a "version", as text.');
    if (!KINDS.includes(library.kind)) problems.push('library.json needs a "kind": "glyph" or "picture".');
  }
  if (index) {
    if (index.schema !== 1) problems.push('icons.json needs "schema": 1.');
    const icons = Array.isArray(index.icons) ? index.icons : [];
    if (!icons.length) problems.push('icons.json holds no icons.');
    const seen = new Set();
    icons.forEach((icon, n) => {
      const where = `Icon ${n + 1}${typeof icon?.slug === 'string' ? ` (${icon.slug})` : ''}`;
      if (typeof icon?.slug !== 'string' || !SLUG.test(icon.slug)) {
        problems.push(`${where} needs a "slug" of lower-case letters, digits and hyphens.`);
      } else if (seen.has(icon.slug)) {
        problems.push(`${where} repeats a slug used before it.`);
      } else {
        seen.add(icon.slug);
      }
      if (typeof icon?.name !== 'string' || !icon.name.trim()) problems.push(`${where} needs a "name".`);
      if (typeof icon?.category !== 'string' || !icon.category.trim()) problems.push(`${where} needs a "category".`);
      if (icon?.keywords !== undefined
          && !(Array.isArray(icon.keywords) && icon.keywords.every((word) => typeof word === 'string'))) {
        problems.push(`${where} has "keywords" that are not a list of words.`);
      }
      if (library?.kind === 'glyph') {
        const problem = glyphProblem(icon);
        if (problem) problems.push(`${where} ${problem}.`);
      }
      if (library?.kind === 'picture') {
        const file = typeof icon?.file === 'string' ? icon.file : '';
        const drawing = files.get(file);
        if (!/^svg\/[a-z0-9-]+\/[a-z0-9][a-z0-9-]*\.svg$/.test(file)) {
          problems.push(`${where} needs a "file" in svg/<category>/<slug>.svg.`);
        } else if (!drawing) {
          problems.push(`${where} needs a "file" that is in the archive.`);
        } else if (UNSAFE.test(drawing.toString('utf8'))) {
          problems.push(`${where} has a drawing with a script in it.`);
        }
      }
    });
  }
  return problems;
}
