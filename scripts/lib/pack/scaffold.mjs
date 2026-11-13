// A first draft of the parts of a pack a person or an assistant writes: brand.json,
// directions.json, audit.json and guide.md, guessed from tokens.json and layouts.json and
// marked as a draft, so that pack check refuses them until they are reviewed.
import { ROLES } from './check.mjs';

const HEX = /^#[0-9a-f]{6}$/;

/** For each role, the tokens.json colour names that usually play it, best first. */
export const ROLE_NAMES = {
  canvasPrimary: ['surface', 'background', 'canvas', 'bg'],
  canvasSecondary: ['surface-panel', 'panel', 'surface-raised', 'surface-secondary', 'mist', 'table-band', 'gray-50',
    'cool-gray-1', 'broadcom-gray'],
  inkPrimary: ['ink', 'text', 'body', 'foreground', 'fg'],
  inkDeep: ['ink-strong', 'ink', 'text', 'body', 'foreground', 'fg'],
  headingPrimary: ['ink-title', 'text-title', 'title', 'heading', 'headline'],
  accentAqua: ['aqua', 'stat', 'accent', 'accent-1', 'jade', 'turquoise', 'teal'],
  inkSecondary: ['ink-secondary', 'ink-muted', 'text-muted', 'text-secondary', 'muted', 'ink-meta'],
  onAccent: ['on-accent', 'text-inverse', 'on-primary'],
  statusCritical: ['status-critical', 'error', 'critical', 'danger', 'red', 'pulse-red'],
};
// When a theme has no named colour for a role, these plain colours stand in.
const PLAIN = {
  light: { canvasPrimary: ['white'], inkPrimary: ['black'], inkDeep: ['black'], headingPrimary: ['blue', 'black'], onAccent: ['white'] },
  dark: { canvasPrimary: ['dark-blue', 'navy-blue', 'black'], inkPrimary: ['white'], inkDeep: ['white'], headingPrimary: ['white'],
    onAccent: ['black'] },
};

const valueFor = (color, theme) => (theme === 'dark' ? color.dark ?? color.light : color.light);

/** The colour each role is guessed to be, for one theme: {colors, unguessed}. */
export function guessRoles(tokens, theme) {
  const byName = new Map((tokens.colors ?? []).map((color) => [color.name, color]));
  const colors = {};
  const unguessed = [];
  for (const [role, names] of Object.entries(ROLE_NAMES)) {
    const found = [...names, ...(PLAIN[theme]?.[role] ?? [])]
      .find((name) => byName.has(name) && HEX.test(String(valueFor(byName.get(name), theme) ?? '')));
    if (found) colors[role] = found;
    else if (ROLES.includes(role)) unguessed.push(role);
  }
  return { colors, unguessed };
}

const round = (value) => Math.round(value);
const boxOf = (placeholder) => {
  const [x, y, width, height] = placeholder.bounds.map(round);
  return { x, y, width, height };
};
const placeholder = (layout, ...types) => (layout?.placeholders ?? []).find((each) => types.includes(each.type) && each.bounds);
const named = (layouts, pattern) => layouts.find((layout) => pattern.test(layout.name));

/** The layout new content slides are built on: "Title Only", else the first with a title and
 *  a body, else the first with a title. */
function contentLayout(layouts) {
  return named(layouts, /^title only$/i)
    ?? layouts.find((layout) => placeholder(layout, 'title', 'ctrTitle') && placeholder(layout, 'body', 'obj'))
    ?? layouts.find((layout) => placeholder(layout, 'title', 'ctrTitle'))
    ?? layouts[0];
}

/** The role whose colour is `hex` in this variant: `expected` when it has that colour, else
 *  the first that does, else none. */
function roleOf(hex, expected, colors, tokens, theme) {
  const byName = new Map(tokens.colors.map((color) => [color.name, color]));
  const plays = (role) => role in colors && valueFor(byName.get(colors[role]), theme) === hex;
  return plays(expected) ? expected : Object.keys(colors).find(plays);
}

function slidesFor(variant, theme, measured, colors, tokens) {
  const layouts = measured.layouts;
  const layout = contentLayout(layouts);
  const canvas = { width: round(measured.canvas.width), height: round(measured.canvas.height) };
  const title = placeholder(layout, 'title', 'ctrTitle');
  const titleBox = title ? boxOf(title) : { x: 48, y: 36, width: canvas.width - 96, height: 60 };
  // The content box: the chosen layout's body, else the largest body of a layout with a title.
  const bodies = layouts.filter((each) => placeholder(each, 'title')).flatMap((each) => each.placeholders)
    .filter((each) => ['body', 'obj'].includes(each.type) && each.bounds);
  const body = placeholder(layout, 'body', 'obj')
    ?? bodies.sort((a, b) => b.bounds[2] * b.bounds[3] - a.bounds[2] * a.bounds[3])[0];
  const top = titleBox.y + titleBox.height + 12;
  const footer = [...(measured.masterArtwork ?? []), ...(layout?.artwork ?? [])]
    .filter((each) => each.bounds && each.bounds[1] > canvas.height * 0.8).map((each) => each.bounds[1]);
  const reservedBottom = round(Math.min(canvas.height - 24, ...footer));
  const contentBox = body ? boxOf(body) : { x: titleBox.x, y: top, width: titleBox.width, height: reservedBottom - top - 12 };
  const roleFor = (each, expected) => (each?.color?.hex && roleOf(each.color.hex, expected, colors, tokens, theme)) || expected;
  const sized = (each, fallback) => (Number.isFinite(each?.size) ? each.size : fallback);
  const bodySize = Math.max(18, sized(body, 20));
  const section = placeholder(named(layouts, /section/i), 'title', 'ctrTitle');
  const quote = placeholder(named(layouts, /quote/i), 'body', 'title');
  const caption = colors.inkSecondary ? 'inkSecondary' : 'inkPrimary';
  const accents = Object.keys(colors).filter((role) => role.startsWith('accent'));
  return {
    template: `templates/${variant}.pptx`,
    layout: layout?.name,
    canvas,
    titleBox,
    contentBox,
    reservedBottom: Math.max(reservedBottom, contentBox.y + contentBox.height),
    spacing: { inset: 16, column: 28 },
    typography: {
      title: { size: sized(title, 28), bold: Boolean(title?.bold), colorRole: roleFor(title, 'headingPrimary') },
      section: { size: sized(section, 40), bold: Boolean(section?.bold), colorRole: roleFor(section, 'headingPrimary') },
      body: { size: bodySize, bold: false, colorRole: roleFor(body, 'inkDeep') },
      bodyReference: { size: Math.max(14, bodySize - 4), bold: false, colorRole: roleFor(body, 'inkDeep') },
      label: { size: Math.max(14, bodySize - 4), bold: true, colorRole: 'inkDeep' },
      caption: { size: 14, bold: false, colorRole: caption },
      metric: { size: 60, bold: false, colorRole: 'accentAqua' },
      quote: { size: sized(quote, 28), bold: false, colorRole: 'inkDeep' },
    },
    chart: { seriesRoles: ['headingPrimary', ...accents] },
    table: { headerFillRole: 'headingPrimary', headerTextRole: colors.onAccent ? 'onAccent' : 'canvasPrimary' },
    icon: { size: 48, colorRole: 'headingPrimary' },
  };
}

function directionFor(id, variant, slides, layouts) {
  const layout = (pattern) => named(layouts, pattern)?.name ?? slides.layout;
  const cover = named(layouts, /cover|title slide/i) ?? layouts.find((each) => placeholder(each, 'ctrTitle'));
  return {
    default: `${id}-${variant}`,
    closing: { withWords: { layout: layout(/clos|thank/i), title: true, subtitles: 0, use: 'A closing whose words matter.' } },
    directions: [{
      id: `${id}-${variant}`,
      name: 'House',
      useWhen: 'Most decks.',
      direction: { focal: 'headingPrimary', neutral: 'canvasSecondary', meanings: {}, motif: 'Review: the device that recurs on every slide.' },
      layouts: { cover: cover?.name ?? slides.layout, section: layout(/section/i), closing: layout(/clos|thank/i) },
    }],
  };
}

export const AUDIT = {
  schema: 1, minTextPt: 18, maxWords: 60, textLedWords: 45, overlapRatio: 0.1, outOfBoundsInches: 0.02,
  contrast: { normal: 4.5, large: 3 }, tolerances: { titlePositionPt: 5, fontPt: 1, iconSizePt: 4 },
  consistency: { minimumSlides: 3, majorityFraction: 0.6 }, starterText: ['click to add', 'click to edit', 'lorem ipsum'],
};

const GUIDE = (name, slides) => `# ${name}

## Brand rules

Review: what ${name} always and never does, each rule with where it comes from.

## Voice and naming

Review: how ${name} writes, and how its organisation and products are named.
${slides ? `
## Slides

Review: how ${name}'s slides are built: recipes, and what to avoid.
` : ''}`;

/** The draft files for a pack with this tokens.json and layouts.json (or null for a pack
 *  without slides): {brand, directions?, audit?, guide, draft}, `draft` saying what to review. */
export function scaffoldPack({ id, name, tokens, layouts, icons = [] }) {
  const measured = Object.entries(layouts?.variants ?? {});
  const themes = tokens.themes?.length ? tokens.themes : ['light'];
  const variants = {};
  const draft = [];
  const directions = { schema: 1, house: ['Review: rules every deck follows, each a sentence.'], variants: {} };
  const names = measured.length ? measured.map(([variant]) => variant) : themes;
  for (const variant of names) {
    const theme = variant.includes('dark') ? 'dark' : 'light';
    const { colors, unguessed } = guessRoles(tokens, theme);
    if (unguessed.length) draft.push(`Variant ${variant} needs a colour for ${unguessed.join(', ')}.`);
    variants[variant] = { theme, colors };
    const found = layouts?.variants?.[variant];
    if (found) {
      variants[variant].slides = slidesFor(variant, theme, found, colors, tokens);
      directions.variants[variant] = directionFor(id, variant, variants[variant].slides, found.layouts);
    }
  }
  draft.push('Check every colour role, slide box and type size against the brand book.');
  if (measured.length) draft.push('Write the deck directions in directions.json and the limits in audit.json.');
  draft.push('Put the logos in assets/ and write guide.md.');
  const families = tokens.type?.families;
  const sans = (layouts ? Object.values(layouts.variants)[0]?.theme?.fonts?.minor : null)
    ?? families?.sans ?? Object.values(families ?? {})[0];
  const brand = {
    schema: 1,
    id,
    name,
    aliases: [...new Set([id, name.toLowerCase()])],
    draft,
    defaultVariant: names.includes('light') ? 'light' : names[0],
    fonts: { sans: String(sans ?? 'Arial').split(',')[0].trim().replace(/^["']|["']$/g, '') },
    variants,
    ...(icons.length ? { icons: icons.map((library, n) => ({ library, default: n === 0, roles: ['headingPrimary', 'accentAqua', 'inkDeep'] })) } : {}),
    logos: { onLight: 'assets/logo-on-light.svg', onDark: 'assets/logo-on-dark.svg' },
    language: { headlineCase: 'sentence', preserveProductNamesAndAcronyms: true, names: [] },
  };
  return {
    brand,
    ...(measured.length ? { directions, audit: AUDIT } : {}),
    guide: GUIDE(name, measured.length > 0),
    draft,
  };
}
