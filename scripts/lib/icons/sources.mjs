// What an icon source holds: an icons.json index of glyphs, or SVG drawings by category.
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { basename, join, relative, sep } from 'node:path';
import { readZip } from '../zip.mjs';

const HIDDEN = (name) => name.split('/').some((part) => part.startsWith('.') || part === '__MACOSX');

/** A source's files, as a Map of path (with /) to Buffer: from a folder, a ZIP archive, one SVG
 *  file or one icons.json. Hidden files, macOS __MACOSX folders and links are left out. */
export function sourceFiles(place) {
  let info;
  try { info = statSync(place); } catch { throw new Error(`There is no source at ${place}.`); }
  if (info.isDirectory()) {
    const files = new Map();
    const byName = (a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0);
    const walk = (folder) => {
      for (const entry of readdirSync(folder, { withFileTypes: true }).sort(byName)) {
        if (entry.isSymbolicLink() || HIDDEN(entry.name)) continue;
        const full = join(folder, entry.name);
        if (entry.isDirectory()) walk(full);
        else if (entry.isFile()) files.set(relative(place, full).split(sep).join('/'), readFileSync(full));
      }
    };
    walk(place);
    return files;
  }
  const data = readFileSync(place);
  if (/\.svg$/i.test(place)) return new Map([[basename(place), data]]);
  if (/\.json$/i.test(place)) return new Map([[basename(place), data]]);
  let files;
  try {
    files = readZip(data);
  } catch (error) {
    throw new Error(`${basename(place)} is not a ZIP archive, a folder, an SVG file or a JSON index (${error.message})`);
  }
  if (files.has('[Content_Types].xml')) {
    throw new Error(`${basename(place)} is a PowerPoint or other Office file; give its icons as SVG files or an icons.json.`);
  }
  return new Map([...files].filter(([name]) => !HIDDEN(name)));
}

export const slugOf = (text) => String(text).normalize('NFKD').replace(/[̀-ͯ]/g, '')
  .replace(/\.svg$/i, '').toLowerCase()
  .replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');

export const titleOf = (slug) => slug.split('-').filter(Boolean)
  .map((word) => word[0].toUpperCase() + word.slice(1)).join(' ');

// Icon folders in a Claude Design export are "Functional <Category>" or "Icons <Category>".
// A bare "Icons" folder (in the Tanzu Division export, the template's product icons) is a
// different set and is not read alongside them.
const ICON_FOLDER = /^(Functional|Icons)\s+/;

function namesIn(readme) {
  const names = new Map();
  for (const [, file, name] of readme.matchAll(/^\|\s*`?([^`|]+?\.svg)`?\s*\|\s*([^|]+?)\s*\|/gim)) {
    names.set(file.trim(), name.trim());
  }
  return names;
}

/** {kind: 'index', path, icons, note} from the shallowest icons.json holding glyph paths,
 *  else {kind: 'svg', drawings: [{path, slug, name, category, text}]}. In an export with
 *  "Functional ..." or "Icons ..." folders, only those folders' SVGs are icons. */
export function readSource(files) {
  const indexes = [...files.keys()].filter((name) => name.split('/').pop() === 'icons.json')
    .sort((a, b) => a.split('/').length - b.split('/').length);
  const unusable = [];
  for (const name of indexes) {
    let parsed;
    try { parsed = JSON.parse(files.get(name).toString('utf8')); } catch { unusable.push(name); continue; }
    if (!Array.isArray(parsed?.icons)
        || !parsed.icons.some((icon) => typeof icon?.d === 'string' || Array.isArray(icon?.paths))) {
      unusable.push(name);
      continue;
    }
    const box = String(parsed.viewBox ?? '0 0 100 100').trim().split(/[\s,]+/).join(' ');
    if (box !== '0 0 100 100') {
      throw new Error(`${name} draws in a ${parsed.viewBox} box; an icon library draws in 0 0 100 100.`);
    }
    return { kind: 'index', path: name, icons: parsed.icons, note: String(parsed.note ?? '') };
  }
  let svgs = [...files.keys()].filter((name) => name.toLowerCase().endsWith('.svg'));
  const folderOf = (name) => name.split('/').slice(-2, -1)[0] ?? '';
  if (svgs.some((name) => ICON_FOLDER.test(folderOf(name)))) {
    svgs = svgs.filter((name) => ICON_FOLDER.test(folderOf(name)));
  }
  const drawings = svgs.sort().map((name) => {
    const folder = name.split('/').slice(0, -1).join('/');
    const readme = files.get(folder ? `${folder}/README.md` : 'README.md');
    const file = name.split('/').pop();
    const slug = slugOf(file);
    return {
      path: name,
      slug,
      name: (readme && namesIn(readme.toString('utf8')).get(file)) || titleOf(slug),
      category: folderOf(name).replace(ICON_FOLDER, '') || 'General',
      text: files.get(name).toString('utf8'),
    };
  });
  if (!drawings.length) {
    throw new Error(unusable.length
      ? `It holds ${unusable[0]}, but that has no icons with glyph paths, and it holds no SVG files.`
      : 'It holds no icons: no icons.json with glyph paths and no SVG files.');
  }
  return { kind: 'svg', drawings };
}
