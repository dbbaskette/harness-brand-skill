// A PowerPoint (OOXML) package: its parts, their XML and their relationships. Element and
// attribute names are matched by local name, so any namespace prefix works.
import { posix } from 'node:path';
import { readZip } from './zip.mjs';
import { parseXml, walk } from './xml.mjs';

export const EMU_PER_PT = 12700;
const MOST_PARTS = 10000;
const MOST_BYTES = 256 * 1024 * 1024;

export const local = (name) => String(name).split(':').pop();
export const child = (node, name) => node?.children.find((each) => local(each.name) === name) ?? null;
export const children = (node, name) => node?.children.filter((each) => local(each.name) === name) ?? [];
export const find = (node, steps) => steps.split('/').reduce((here, step) => child(here, step), node);
export const descendants = (node, name) => (node ? [...walk(node)].filter((each) => each !== node && local(each.name) === name) : []);
export const descendant = (node, name) => descendants(node, name)[0] ?? null;

/** An attribute by name: the exact name if the element has it, else by local name, such as "id" for r:id. */
export function attr(node, name) {
  if (!node) return undefined;
  if (Object.hasOwn(node.attrs, name)) return node.attrs[name];
  for (const [key, value] of Object.entries(node.attrs)) if (local(key) === name) return value;
  return undefined;
}

/** The package in `buffer`: {parts, xml(part), rels(part), related(part, type), target(part, id)}.
 *  Refuses what is not a presentation, and parts that could not be placed safely. */
export function openPackage(buffer) {
  // The limits are kept while unpacking, so a file that claims to be huge is refused before it is unpacked.
  const parts = readZip(buffer, { maxBytes: MOST_BYTES, maxEntries: MOST_PARTS });
  for (const name of parts.keys()) {
    if (name.startsWith('/') || name.includes('\\') || name.split('/').includes('..')) {
      throw new Error(`It holds a part that cannot be placed: ${name}.`);
    }
  }
  if (!parts.has('ppt/presentation.xml')) throw new Error('It is not a PowerPoint presentation: it has no ppt/presentation.xml.');
  const cache = new Map();
  const xml = (part) => {
    if (!cache.has(part)) {
      const data = parts.get(part);
      if (!data) throw new Error(`It has no ${part}.`);
      try {
        cache.set(part, parseXml(data.toString('utf8')));
      } catch (error) {
        throw new Error(`Its ${part} cannot be read: ${error.message}`);
      }
    }
    return cache.get(part);
  };
  const rels = (part) => {
    const dir = posix.dirname(part);
    const file = `${dir}/_rels/${posix.basename(part)}.rels`;
    if (!parts.has(file)) return [];
    return children(xml(file), 'Relationship').filter((each) => each.attrs.TargetMode !== 'External').map((each) => {
      const raw = String(each.attrs.Target ?? '');
      let target = raw.startsWith('/') ? posix.normalize(raw.slice(1)) : posix.normalize(posix.join(dir, raw));
      if (!raw || target === '.' || target === '..' || target.startsWith('../')) {
        target = null;   // empty, or outside the package
      } else if (!parts.has(target)) {
        try {
          const decoded = decodeURIComponent(target);
          if (parts.has(decoded)) target = decoded;   // a name written with %20 and the like
        } catch { /* not encoded: keep it as written */ }
      }
      return { id: each.attrs.Id, type: String(each.attrs.Type ?? '').split('/').pop(), target };
    });
  };
  const related = (part, type) => rels(part).find((each) => each.type === type)?.target ?? null;
  const target = (part, id) => rels(part).find((each) => each.id === id)?.target ?? null;
  return { parts, xml, rels, related, target };
}

/** The relationship id on an element (r:id), as opposed to its own plain `id`. */
export function relationId(node) {
  for (const [key, value] of Object.entries(node?.attrs ?? {})) if (key.includes(':') && local(key) === 'id') return value;
  return undefined;
}
