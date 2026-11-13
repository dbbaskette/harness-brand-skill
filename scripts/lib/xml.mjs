// A small XML reader for Office and SVG files: elements, attributes and text. Document types that
// declare entities are refused (a plain one is skipped), so no entity is ever expanded beyond the
// five standard ones and numbers.
const ENTITIES = { lt: '<', gt: '>', amp: '&', quot: '"', apos: "'" };

export function decode(text) {
  return text.replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (whole, name) => {
    if (name[0] !== '#') return ENTITIES[name] ?? whole;
    const hex = name[1] === 'x' || name[1] === 'X';
    const code = parseInt(name.slice(hex ? 2 : 1), hex ? 16 : 10);
    const invalid = !Number.isFinite(code) || code === 0 || (code >= 0xd800 && code <= 0xdfff) || code > 0x10ffff;
    if (invalid) throw new Error(`The XML has the number reference &${name}; that is not a character.`);
    return String.fromCodePoint(code);
  });
}

function closing(text, from, marker) {
  const at = text.indexOf(marker, from);
  if (at < 0) throw new Error(`The XML has no ${marker} to end what starts at ${from}.`);
  return at;
}

function endOfTag(text, open) {
  let quote = null;
  for (let i = open + 1; i < text.length; i += 1) {
    const ch = text[i];
    if (quote) { if (ch === quote) quote = null; }
    else if (ch === '"' || ch === "'") quote = ch;
    else if (ch === '>') return i;
  }
  throw new Error(`The XML tag at ${open} never ends.`);
}

function attributes(text) {
  const attrs = {};
  for (const [, name, , double, single] of text.matchAll(/([^\s=]+)\s*=\s*("([^"]*)"|'([^']*)')/g)) {
    attrs[name] = decode(double ?? single);
  }
  return attrs;
}

/** The document's root element: {name, attrs, children, text}, `text` being its own text. */
export function parseXml(text) {
  const document = { name: '#document', attrs: {}, children: [], text: '' };
  const stack = [document];
  let at = 0;
  while (at < text.length) {
    const open = text.indexOf('<', at);
    const top = stack[stack.length - 1];
    if (open < 0) { top.text += decode(text.slice(at)); break; }
    if (open > at) top.text += decode(text.slice(at, open));
    if (text.startsWith('<!--', open)) { at = closing(text, open, '-->') + 3; continue; }
    if (text.startsWith('<![CDATA[', open)) {
      const end = closing(text, open, ']]>');
      top.text += text.slice(open + 9, end);
      at = end + 3;
      continue;
    }
    if (text.startsWith('<?', open)) { at = closing(text, open, '?>') + 2; continue; }
    if (text.startsWith('<!', open)) {
      const end = endOfTag(text, open);
      if (text.slice(open, end).includes('[')) {
        throw new Error('XML with a document type that declares entities is not read.');
      }
      at = end + 1;
      continue;
    }
    const end = endOfTag(text, open);
    const inner = text.slice(open + 1, end);
    at = end + 1;
    if (inner.startsWith('/')) {
      const name = inner.slice(1).trim();
      if (stack.length < 2) throw new Error(`The XML closes ${name} but nothing is open.`);
      if (top.name !== name) {
        throw new Error(`The XML closes ${name} where ${top.name} is open.`);
      }
      stack.pop();
      continue;
    }
    const empty = inner.endsWith('/');
    const body = empty ? inner.slice(0, -1) : inner;
    const name = /^[^\s/>]+/.exec(body)?.[0];
    if (!name) throw new Error(`The XML has a tag with no name at ${open}.`);
    const node = { name, attrs: attributes(body.slice(name.length)), children: [], text: '' };
    top.children.push(node);
    if (!empty) stack.push(node);
  }
  if (stack.length !== 1) throw new Error(`The XML ends with ${stack[stack.length - 1].name} still open.`);
  if (document.children.length > 1) throw new Error('The XML has more than one root element.');
  const root = document.children[0];
  if (!root) throw new Error('The XML holds no element.');
  return root;
}

export const kids = (node, name) => node.children.filter((child) => child.name === name);
export const kid = (node, name) => node.children.find((child) => child.name === name) ?? null;

/** The element at `steps` ("a/b/c") below `node`, following the first match each step. */
export function path(node, steps) {
  let here = node;
  for (const step of steps.split('/')) {
    here = here && kid(here, step);
    if (!here) return null;
  }
  return here;
}

export function* walk(node) {
  yield node;
  for (const child of node.children) yield* walk(child);
}

/** Every element named `name` at or below `node`, in document order. */
export const all = (node, name) => [...walk(node)].filter((each) => each.name === name);
