// A design system's tokens as a pack's tokens.json: every colour with its light and dark value,
// the type styles, spacing, radius and the rest, read from a Claude Design export (tokens.json,
// with the values tokens.css gives each theme) or from a folder holding the same files.

const amount = (text) => {
  const value = String(text).trim();
  return value.endsWith('%') ? parseFloat(value) / 100 : parseFloat(value);
};

/** `#rrggbb` for a colour written as #rgb, #rrggbb, #rrggbbff, or an opaque rgb() or rgba()
 *  (with commas or spaces), else null. */
export function hexColor(text) {
  const value = String(text ?? '').trim().toLowerCase();
  let match = /^#([0-9a-f]{3})$/.exec(value);
  if (match) return `#${[...match[1]].map((c) => c + c).join('')}`;
  if (/^#[0-9a-f]{6}$/.test(value)) return value;
  if (/^#[0-9a-f]{6}ff$/.test(value)) return value.slice(0, 7);
  match = /^rgba?\(([^)]*)\)$/.exec(value);
  if (!match) return null;
  const parts = match[1].split(/\s*[,/]\s*|\s+/).filter(Boolean);
  if (parts.length < 3 || parts.length > 4 || (parts.length === 4 && amount(parts[3]) !== 1)) return null;
  const channels = parts.slice(0, 3).map((part) => Math.round(part.endsWith('%') ? parseFloat(part) * 2.55 : parseFloat(part)));
  if (!channels.every((c) => Number.isFinite(c) && c >= 0 && c <= 255)) return null;
  return `#${channels.map((c) => c.toString(16).padStart(2, '0')).join('')}`;
}

const LIGHT = new Set([':root', '[data-theme="light"]', ':root[data-theme="light"]', 'html[data-theme="light"]']);
const DARK = new Set(['[data-theme="dark"]', ':root[data-theme="dark"]', 'html[data-theme="dark"]']);

/** Which theme a rule's selector sets, or null: only rules for the whole page count, so a
 *  scoped rule (`.card`), a class switch (`.dark`) or a negation is never mistaken for one. */
function themeOf(selector) {
  const parts = selector.toLowerCase().replace(/'/g, '"').replace(/\s+/g, ' ').split(',').map((part) => part.trim());
  if (parts.every((part) => LIGHT.has(part))) return 'light';
  if (parts.every((part) => DARK.has(part))) return 'dark';
  return null;
}

/** The custom properties tokens.css sets for each theme: {light: {name: value}, dark: {...}}.
 *  Rules inside an at-rule (such as @media) are left out. */
export function parseThemes(css) {
  const themes = { light: {}, dark: {} };
  const text = String(css).replace(/\/\*[\s\S]*?\*\//g, '');
  let at = 0;
  while (at < text.length) {
    const open = text.indexOf('{', at);
    if (open < 0) break;
    let depth = 1;
    let close = open + 1;
    while (close < text.length && depth) {
      if (text[close] === '{') depth += 1;
      else if (text[close] === '}') depth -= 1;
      close += 1;
    }
    const selector = text.slice(at, open).trim();
    const body = text.slice(open + 1, close - 1);
    at = close;
    const theme = selector.startsWith('@') ? null : themeOf(selector);
    if (!theme || body.includes('{')) continue;
    for (const declaration of body.split(';')) {
      const match = /^\s*--([\w-]+)\s*:\s*([\s\S]*?)\s*$/.exec(declaration);
      if (match) themes[theme][match[1]] = match[2].replace(/\s*!important$/i, '').trim();
    }
  }
  return themes;
}

/** Text with a var() in a theme followed through that theme, then the light one. */
function resolveText(themes, theme, text, seen) {
  if (text === undefined || text === null) return null;
  const reference = /^var\(\s*--([\w-]+)\s*(?:,\s*([\s\S]+))?\)$/.exec(String(text).trim());
  if (!reference) return String(text).trim();
  return resolve(themes, theme, reference[1], seen) ?? (reference[2] ? resolveText(themes, theme, reference[2], seen) : null);
}

function resolve(themes, theme, name, seen = new Set()) {
  if (seen.has(name)) return null;
  seen.add(name);
  return resolveText(themes, theme, themes[theme][name] ?? themes.light[name], seen);
}

/** A token's value in tokens.json for a theme: a plain value is the light one (with `dark`
 *  beside it, if given); an object gives `light` and `dark`; `{name}` stands for another
 *  token's value, in each theme. */
function valueIn(token, theme, byName, seen = new Set()) {
  const given = token?.value;
  let value;
  if (given && typeof given === 'object') value = given[theme];
  else if (typeof given === 'string' && /^\{[^{}]+\}$/.test(given.trim())) value = given;   // an alias, in every theme
  else value = theme === 'dark' ? token?.dark : given;
  if (typeof value !== 'string') return null;
  const alias = /^\{([^{}]+)\}$/.exec(value.trim());
  if (!alias) return value.trim();
  if (seen.has(alias[1])) return null;
  seen.add(alias[1]);
  const target = byName.get(alias[1]);
  if (!target) return null;
  return valueIn(target, theme, byName, seen) ?? (theme === 'dark' ? valueIn(target, 'light', byName, seen) : null);
}

const named = (files, file) => [...files.keys()].filter((name) => name.split('/').pop() === file)
  .sort((a, b) => a.split('/').length - b.split('/').length)[0];
const colorText = (text) => (text === null || text === undefined ? null : hexColor(text) ?? String(text));

/** tokens.json for a pack, from the files of an export (a Map of path to Buffer). */
export function readTokens(files) {
  const jsonPath = named(files, 'tokens.json');
  if (!jsonPath) throw new Error('It holds no tokens.json.');
  let tokens;
  try {
    tokens = JSON.parse(files.get(jsonPath).toString('utf8'));
  } catch (error) {
    throw new Error(`Its ${jsonPath} is not JSON (${error.message}).`);
  }
  if (!tokens || typeof tokens !== 'object' || !Array.isArray(tokens.color?.tokens)) {
    throw new Error(`Its ${jsonPath} has no colour tokens (color.tokens).`);
  }
  const cssPath = jsonPath.replace(/tokens\.json$/, 'tokens.css');
  const themes = files.has(cssPath) ? parseThemes(files.get(cssPath).toString('utf8')) : { light: {}, dark: {} };
  const byName = new Map(tokens.color.tokens.filter((token) => token?.name).map((token) => [String(token.name).trim(), token]));
  const colors = [];
  for (const [name, token] of byName) {
    // tokens.css, when it names the colour, gives what a page shows; tokens.json fills in the rest.
    const light = colorText(resolve(themes, 'light', name) ?? valueIn(token, 'light', byName));
    const dark = colorText(resolve(themes, 'dark', name) ?? valueIn(token, 'dark', byName));
    const color = { name };
    if (light !== null) color.light = light;
    if (dark !== null && dark !== light) color.dark = dark;
    if (token.usage) color.usage = String(token.usage);
    colors.push(color);
  }
  // Colours tokens.css names that tokens.json does not, such as surface or chart-1.
  for (const name of [...new Set([...Object.keys(themes.light), ...Object.keys(themes.dark)])]) {
    if (byName.has(name)) continue;
    const light = name in themes.light ? hexColor(resolve(themes, 'light', name)) : null;
    const dark = hexColor(resolve(themes, 'dark', name));
    if (!light && !dark) continue;
    const color = { name };
    if (light) color.light = light;
    if (dark && dark !== light) color.dark = dark;
    color.usage = 'Named in tokens.css only.';
    colors.push(color);
  }
  const styles = (tokens.type?.groups ?? []).flatMap((group) => (group?.styles ?? []).map((style) => ({
    ...style, group: group.name, ...(group.family ? { family: group.family } : {}) })));
  const known = new Set(['name', 'version', 'meta', 'color', 'type', 'spacing', 'radius']);
  const other = Object.fromEntries(Object.entries(tokens).filter(([key]) => !known.has(key)));
  return {
    schema: 1,
    name: String(tokens.name ?? ''),
    themes: (tokens.color.themes ?? []).map((theme) => String(theme?.id ?? theme)).filter(Boolean),
    colors,
    type: { families: tokens.type?.families ?? {}, styles },
    spacing: tokens.spacing?.tokens ?? [],
    radius: tokens.radius?.tokens ?? [],
    ...(Object.keys(other).length ? { other } : {}),
    source: { name: tokens.name ?? null, version: tokens.version ?? null, file: jsonPath },
  };
}
