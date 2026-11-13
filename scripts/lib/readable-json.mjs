// JSON for files people and assistants read: objects and arrays opened one entry to a line,
// but a short value, a list of plain values, or a small flat object kept on one line.
const SHORT = 100;   // characters: a value this long or shorter stays on one line
const FLAT = 400;    // characters: a flat object (no long nested values) this long or shorter stays on one line
const NESTED = 60;   // characters: a nested value shorter than this still counts as flat

// The value laid out as JSON text, or undefined for what JSON leaves out (undefined, functions, symbols).
function layout(value, indent) {
  const flat = JSON.stringify(value);
  if (flat === undefined || value === null || typeof value !== 'object' || flat.length <= SHORT) return flat;
  if (Array.isArray(value) && value.every((each) => each === null || typeof each !== 'object')) return flat;
  if (!Array.isArray(value) && flat.length <= FLAT
      && Object.values(value).every((each) => each === null || typeof each !== 'object' || JSON.stringify(each).length < NESTED)) {
    return flat;
  }
  const inner = `${indent}  `;
  if (Array.isArray(value)) {
    return `[\n${value.map((each) => inner + (layout(each, inner) ?? 'null')).join(',\n')}\n${indent}]`;
  }
  const entries = Object.entries(value).map(([key, each]) => [key, layout(each, inner)]).filter(([, text]) => text !== undefined);
  return `{\n${entries.map(([key, text]) => `${inner}${JSON.stringify(key)}: ${text}`).join(',\n')}\n${indent}}`;
}

export const readableJson = (value) => `${layout(value, '')}\n`;
