// Example Co: a small brands folder with one finished brand pack and one icon library, for
// the tests of pack check, pack scaffold and pack seal.
import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { buildLibrary, libraryArchive } from '../../scripts/lib/icons/library.mjs';
import { measureTemplate, mergeLayouts } from '../../scripts/lib/pack/measure.mjs';
import { readTokens } from '../../scripts/lib/pack/tokens.mjs';
import { readableJson } from '../../scripts/lib/readable-json.mjs';
import { makeTemplate } from './template.mjs';

export const TOKENS = {
  name: 'Example Co',
  color: {
    themes: [{ id: 'light' }],
    tokens: [
      { name: 'white', value: '#ffffff', usage: 'Slide ground.' },
      { name: 'mist', value: '#eef2f6', usage: 'Panels and supporting cards.' },
      { name: 'black', value: '#000000', usage: 'Body text.' },
      { name: 'dark-gray', value: '#53565a', usage: 'Captions.' },
      { name: 'blue', value: '#005c8a', usage: 'Titles.' },
      { name: 'aqua', value: '#007b8c', usage: 'The main accent.' },
      { name: 'red', value: '#cc092f', usage: 'Warnings.' },
    ],
  },
};

const style = (size, colorRole, bold = false) => ({ size, bold, colorRole });

export const BRAND = {
  schema: 1,
  id: 'example',
  name: 'Example Co',
  aliases: ['example', 'example co'],
  defaultVariant: 'light',
  fonts: { sans: 'Arial' },
  variants: {
    light: {
      theme: 'light',
      colors: {
        canvasPrimary: 'white', canvasSecondary: 'mist', inkPrimary: 'black', inkDeep: 'black', inkSecondary: 'dark-gray',
        headingPrimary: 'blue', accentAqua: 'aqua', onAccent: 'white', statusCritical: 'red',
      },
      slides: {
        template: 'templates/light.pptx',
        layout: 'Title Only',
        canvas: { width: 960, height: 540 },
        titleBox: { x: 48, y: 36, width: 864, height: 60 },
        contentBox: { x: 48, y: 120, width: 864, height: 360 },
        reservedBottom: 492,
        typography: {
          title: style(28, 'headingPrimary'), body: style(24, 'inkDeep'), bodyReference: style(20, 'inkDeep'),
          label: style(20, 'inkDeep', true), caption: style(14, 'inkSecondary'), metric: style(60, 'accentAqua'),
          quote: style(30, 'inkDeep'),
        },
        chart: { seriesRoles: ['headingPrimary', 'accentAqua'] },
        table: { headerFillRole: 'headingPrimary', headerTextRole: 'onAccent' },
        icon: { size: 48, colorRole: 'headingPrimary' },
        image: { frameRole: 'canvasSecondary', frameWidthPt: 1, calloutRole: 'accentAqua', fit: 'contain' },
        fills: { tints: false },
      },
    },
  },
  icons: [{ library: 'example-icons', default: true, roles: ['headingPrimary', 'accentAqua', 'inkDeep'] }],
  logos: { onLight: 'assets/logo-on-light.svg', onDark: 'assets/logo-on-dark.svg' },
  language: { headlineCase: 'sentence', preserveProductNamesAndAcronyms: true, names: ['Write Example Co in full.'] },
};

export const DIRECTIONS = {
  schema: 1,
  house: ['Use one approved icon for each concrete idea.'],
  variants: {
    light: {
      default: 'example-clear',
      closing: { withWords: { layout: 'Title Only', title: true, subtitles: 0, use: 'A closing whose words matter.' } },
      directions: [{
        id: 'example-clear',
        name: 'Clear',
        useWhen: 'Most decks.',
        direction: { focal: 'headingPrimary', neutral: 'canvasSecondary', meanings: { accentAqua: 'Example Platform' },
          motif: 'A strip on each card says what it is about.' },
        layouts: { cover: 'Title Slide', section: 'Title Only', closing: 'Title Only' },
      }],
    },
  },
};

export const GUIDE = `# Example Co

## Brand rules

Example Co is always written in full (brand book, page 2).

## Voice and naming

Plain words, sentence case (brand book, page 3).

## Slides

Build content slides on Title Only (template).
`;

const LOGO = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 10 10"><rect width="10" height="10"/></svg>';
const ICONS = { viewBox: '0 0 100 100', note: 'Brand colours only.', icons: [
  { slug: 'cloud', name: 'Cloud', category: 'Cloud', bounds: [0, 0, 50, 50], d: 'M0 0 L50 0 L50 50 Z' },
  { slug: 'server', name: 'Server', category: 'Data Center', bounds: [0, 0, 50, 50], d: 'M0 0 L50 50 L0 50 Z' },
] };

/** A brands folder holding Example Co (brands/example) and the example-icons library.
 *  Returns {brands, pack}. `brand` replaces brand.json; `files` adds or, given null, removes
 *  pack files (paths inside the pack). */
export function makeBrands({ brand = BRAND, files = {} } = {}) {
  const brands = join(mkdtempSync(join(tmpdir(), 'hb-brands-')), 'brands');
  const pack = join(brands, 'example', 'pack');
  const sources = join(brands, 'example', 'sources');
  const template = makeTemplate();
  const put = (place, data) => {
    mkdirSync(join(place, '..'), { recursive: true });
    writeFileSync(place, data);
  };
  put(join(sources, 'tokens.json'), JSON.stringify(TOKENS));
  put(join(sources, 'template.pptx'), template);
  const contents = {
    'brand.json': readableJson(brand),
    'tokens.json': readableJson(readTokens(new Map([['tokens.json', Buffer.from(JSON.stringify(TOKENS))]]))),
    'templates/light.pptx': template,
    'layouts.json': readableJson(mergeLayouts(null, 'light', measureTemplate(template, { variant: 'light' }))),
    'guide.md': GUIDE,
    'directions.json': readableJson(DIRECTIONS),
    'audit.json': readableJson({ schema: 1 }),
    'assets/logo-on-light.svg': LOGO,
    'assets/logo-on-dark.svg': LOGO,
    ...files,
  };
  for (const [file, data] of Object.entries(contents)) if (data !== null) put(join(pack, file), data);
  const built = buildLibrary([{ label: 'icons.json', files: new Map([['icons.json', Buffer.from(JSON.stringify(ICONS))]]) }],
    { id: 'example-icons', name: 'Example icons' });
  put(join(brands, 'icon-libraries', 'example-icons', 'library.zip'), libraryArchive(built));
  return { brands, pack };
}
