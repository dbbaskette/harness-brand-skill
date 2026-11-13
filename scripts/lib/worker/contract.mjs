// The brand contract a studio hands Harness Slides or a blog writer, made from a brand pack:
// brand-contract.json, DESIGN.md, VOICE.md and, for slides, deck-direction.json. Harness Slides'
// own module gives the contract its revision and checks it, so the two never disagree.
import { mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { sha256 } from '../pack/check.mjs';
import { packJson } from './brands.mjs';
import { deckFor } from './icons.mjs';
import { slidesModule } from './slides.mjs';

const TONE = 'unspecified; use supplied organization rules, never infer tone from visual identity';
const LOOK = 'Before the first build of a new deck or full rework, build one representative content slide in two or three of these directions, render each natively and let the user pick. The pick is the deck\'s direction. Skip only when the caller supplies an approved direction for this deck. A sample settles color meaning and treatment, never one layout for every slide.';
const fillsText = (tints) => `Fill colors come only from roles, and the contract exports design.slides.fills: {tints: ${tints}}. Light card fills are the neutral panel role;${tints ? '' : ' brand colors are never tinted, lightened or made transparent.'} Meaning colors fill whole cards, bands and badges, or tag a neutral card with a bar strip; the engine picks white or dark text for contrast. Status colors mark a badge, strip or small card, never a large panel.`;
// Commands a worker is told to run name this installed command and the brands folder in full,
// since a worker has neither harness-brand on its PATH nor HARNESS_BRAND_DATA.
const CLI = fileURLToPath(new URL('../../harness-brand.mjs', import.meta.url));
const command = (brands, words) => `node "${CLI}" ${words} --data "${brands}"`;
const CODE_NOTE = 'Use it for inline code and short code (commands, file, API and setting names) at the size of the surrounding text, never for prose, titles or headings.';

const hexOf = (tokens, name, theme) => {
  const color = tokens.colors.find((each) => each.name === name);
  return String(theme === 'dark' ? color.dark ?? color.light : color.light).toUpperCase();
};

/** The deck directions of one variant, resolved as Harness Slides takes them. */
function deckOf(directions, variant, brandId, tints, brands, icons) {
  const entry = directions.variants[variant];
  const chosen = entry.directions.find((each) => each.id === entry.default);
  const { thanks, withWords } = entry.closing;
  return {
    default: chosen.id,
    direction: chosen.direction,
    layouts: { cover: chosen.layouts.cover, section: chosen.layouts.section, closing: chosen.layouts.closing },
    closing: { withWords: { ...withWords, layout: chosen.layouts.closing },
      ...(thanks ? { thanks: { ...thanks, layout: chosen.layouts.thanks ?? thanks.layout } } : {}) },
    stripOnly: entry.stripOnly?.roles ?? [],
    // A brand with no icon deck cannot place icons, so a house rule asking for them is left out.
    house: directions.house.filter((line) => icons || !/harness-brand icons/.test(line)).map((line) => line.replaceAll('{brand}', brandId)
      .replace(/`harness-brand (icons [^`]*)`/g, (whole, words) => `\`${command(brands, words)}\``)),
    directions: entry.directions.map((each) => ({ id: each.id, name: each.name, useWhen: each.useWhen, direction: each.direction,
      layouts: each.layouts, cues: each.cues ?? {}, keys: each.keys ?? {} })),
    look: LOOK,
    fills: fillsText(tints),
  };
}

/** The contract for a chosen pack ({id, pack, brand, variant} from choose()). */
export async function buildContract(chosen, { medium = 'slides', delivery = 'reading', voiceProfile } = {}) {
  if (!['slides', 'blog'].includes(medium) || !['live', 'reading'].includes(delivery)) throw new Error('Choose medium slides|blog and delivery live|reading');
  const { pack, brand, variant } = chosen;
  const settings = brand.variants[variant];
  if (medium === 'slides' && !settings.slides) throw new Error(`The ${brand.name} brand has no slides: its ${variant} variant has no template.`);
  const sources = [];
  const source = (path, kind) => {
    const bytes = readFileSync(path);
    sources.push({ path, kind, sha256: sha256(bytes) });
    return bytes;
  };
  source(join(pack, 'brand.json'), 'brand');
  const tokens = JSON.parse(source(join(pack, 'tokens.json'), 'tokens'));
  source(join(pack, 'guide.md'), 'brand policy');
  const colors = Object.fromEntries(Object.entries(settings.colors).map(([role, name]) => [role, hexOf(tokens, name, settings.theme)]));
  const visual = brand.visual ?? {};
  const design = {
    fontFamily: brand.fonts.sans,
    colors,
    geometry: visual.geometry ?? {},
    imagery: visual.imagery ?? {},
    logos: visual.logos ?? { policy: 'Retain native template identity artwork; do not recreate' },
    accessibility: visual.accessibility ?? {},
    ...(visual.colorPolicy ? { colorPolicy: visual.colorPolicy } : {}),
    ...(visual.emphasis ? { emphasis: visual.emphasis } : {}),
    ...(medium === 'blog' && visual.infographicTypography ? { infographicTypography: visual.infographicTypography } : {}),
    references: { guide: join(pack, 'guide.md'), icons: `Use the brand's approved icons: ${command(dirname(dirname(pack)), `icons --brand ${brand.id} --query "<concept>"`)}` },
  };
  if (medium === 'slides') {
    const s = settings.slides;
    const measured = packJson(pack, 'layouts.json').variants[variant];
    source(join(pack, 'layouts.json'), 'layouts');
    const templatePath = join(pack, s.template);
    const template = source(templatePath, 'native template');
    const layout = measured.layouts.find((each) => each.name === s.layout);
    const directions = JSON.parse(source(join(pack, 'directions.json'), 'deck directions'));
    const tints = s.fills?.tints ?? false;
    // The icon deck travels in the contract, hashed, so the slide engine can copy icons as native geometry.
    const deck = deckFor(dirname(dirname(pack)), chosen);
    if (deck) { source(deck.path, 'icon library'); source(deck.index, 'icon index'); }
    const body = s.typography[delivery === 'live' ? 'body' : 'bodyReference'];
    design.slides = {
      canvas: s.canvas, titleBox: s.titleBox, contentBox: s.contentBox,
      ...(s.reservedBottom !== undefined ? { reservedBottom: s.reservedBottom } : {}),
      spacing: { inset: 16, column: 28, ...s.spacing },
      typography: { ...s.typography, code: { fontFamily: brand.fonts.mono ?? 'Courier New', size: body.size, bold: false, colorRole: 'inkDeep' } },
      chart: s.chart, table: s.table, ...(s.image ? { image: s.image } : {}), icon: { ...s.icon, ...(deck ? { library: deck } : {}) },
      fills: { tints },
      deck: deckOf(directions, variant, brand.id, tints, dirname(dirname(pack)), Boolean(deck)),
    };
    design.nativeTemplate = { path: templatePath, sha256: sha256(template), layoutPart: layout.part, masterPart: measured.master };
  }
  let authorVoice = { status: 'unselected' };
  if (voiceProfile) {
    const path = resolve(voiceProfile);
    const bytes = source(path, 'selected author voice');
    let voice;
    try { voice = JSON.parse(bytes); } catch { voice = null; }
    if (!voice?.id || typeof voice.guide !== 'string' || !voice.guide.trim() || !['provisional', 'confirmed'].includes(voice.status)) {
      throw new Error('Portable voice needs id, guide and explicit provisional|confirmed status');
    }
    authorVoice = { id: voice.id, revision: voice.revision ?? null, status: voice.status, guide: voice.guide, sha256: sha256(bytes) };
  }
  const { names, ...rules } = brand.language ?? {};
  const contract = {
    schema: 1,
    identity: { id: brand.id, name: brand.name, variant },
    medium: { kind: medium, delivery: medium === 'blog' ? 'reading' : delivery },
    sources,
    design,
    language: { organization: { rules: { ...rules, ...(names?.length ? { names } : {}) }, toneStatus: TONE }, authorVoice },
  };
  const { contractRevision, validateBrandContract } = await slidesModule('scripts/lib/brand-contract.mjs');
  contract.revision = contractRevision(contract);
  validateBrandContract(contract);
  return contract;
}

const deckLine = (entry) => `${entry.id} (${entry.name}; ${entry.useWhen.replace(/\.$/, '')}): ${JSON.stringify(entry.direction)}`;

/** The deck-direction section of DESIGN.md. */
function deckGuidance(deck, contract) {
  const chosen = deck.directions.find((each) => each.id === deck.default);
  const others = deck.directions.filter((each) => each.id !== deck.default);
  const { thanks, withWords } = deck.closing;
  const { id, variant } = contract.identity;
  return `## Deck direction\n\nRead deck-direction.json beside the exported contract. ${deck.look} Copy the chosen \`direction\` into the composition or outline unchanged, its \`house\` lines into the outline's house style and its \`layouts\` into the outline's layouts.\n\n`
    + `Default, ${deckLine(chosen)}.\n\n${others.length ? `Alternates: ${others.map(deckLine).join('; ')}.\n\n` : ''}`
    + `${deck.fills}\n\n## Composer rules\n\n${deck.house.map((line) => `- ${line}`).join('\n')}\n\n`
    + `## Lead slides\n\nDefault cover \`${deck.layouts.cover}\`, section \`${deck.layouts.section}\`, closing \`${deck.layouts.closing}\`; each direction names its own set. Closing: \`${withWords.layout}\` shows a title${withWords.subtitles ? ` and ${withWords.subtitles} subtitle line${withWords.subtitles === 1 ? '' : 's'}` : ''}. ${withWords.use}${thanks ? ` A thanks-only closing may use \`${thanks.layout}\` instead: ${thanks.use}` : ''} List every layout with \`${command(dirname(dirname(dirname(contract.design.references.guide))), `layouts --brand ${id} --variant ${variant}`)}\`.\n\n`;
}

/** DESIGN.md and VOICE.md for a contract. */
export function contractViews(c) {
  const d = c.design;
  const s = d.slides;
  const slides = s ? `Canvas and safe boxes (points): ${JSON.stringify({ canvas: s.canvas, title: s.titleBox, content: s.contentBox, reservedBottom: s.reservedBottom })}.\n\n`
    + `Delivery: ${c.medium.delivery}; body role: ${c.medium.delivery === 'live' ? 'body' : 'bodyReference'}. Typography: ${JSON.stringify(s.typography)}.\n\n`
    + `Inline code: the \`code\` role, ${s.typography.code.fontFamily}. ${CODE_NOTE}\n\n`
    + `Reuse native template ${d.nativeTemplate.path}, layout ${d.nativeTemplate.layoutPart}; retain its master artwork.\n\n${deckGuidance(s.deck, c)}` : '';
  const meaning = d.colorPolicy?.focal
    ? `headingPrimary for headings, canvasSecondary for panels and subordinate groups, inkDeep for text. Focal color: one of ${d.colorPolicy.focal.roles.join(', ')}; dark fills: ${d.colorPolicy.focal.darkRole}. ${d.colorPolicy.focal.note ?? ''}`
    : s ? 'the chosen deck direction assigns the focal, the panel neutral and what each other color stands for; headingPrimary carries titles and inkDeep text.'
      : 'headingPrimary for focal findings and headings, canvasSecondary for subordinate groups, inkDeep for text; accentAqua is available for a labeled actor, state or boundary.';
  const close = s
    ? 'Use approved native icons when they help explain content. New decks and reworks approve the draft as a whole, then choose a representative look; content-preserving redesigns go slide by slide. Honor batch approval, settled choices and explicit autonomy. Inspect the final native output and honor the user\'s final review. Choose each composition from its content and evidence; native diagrams carry factual relationships. Generated art may illustrate concepts only where the imagery policy allows; it is never measured evidence or identity artwork.'
    : 'Apply the selected identity to article illustrations and visual hierarchy. Preserve the manuscript scope, evidence, qualifications and selected author voice. Use the article workflow and the user\'s existing authorization for editorial decisions.';
  const visual = { geometry: d.geometry, imagery: d.imagery, logos: d.logos, accessibility: d.accessibility, ...(d.emphasis ? { emphasis: d.emphasis } : {}) };
  const design = `# ${c.identity.name} design · ${c.medium.kind}\n\nContract revision: ${c.revision}\n\nFont: ${d.fontFamily}. Color roles: ${JSON.stringify(d.colors)}.\n\n${slides}`
    + `Color meaning: ${meaning} Keep recurring meanings consistent and use words as well as color. A routine caution is not automatically a dominant full-width band. Choose region size by its content.\n\n`
    + `Visual rules: ${JSON.stringify(visual)}.${d.colorPolicy ? `\n\nColor policy: ${JSON.stringify(d.colorPolicy)}.` : ''}\n\n`
    + `Read the brand's rules only when relevant: ${d.references.guide}. ${close}\n`;
  const voice = `# Language and author voice\n\nContract revision: ${c.revision}\n\nOrganization language: ${JSON.stringify(c.language.organization)}.\n\n`
    + `Author voice status: ${c.language.authorVoice.status}.\n\n${c.language.authorVoice.guide ?? 'No author voice selected. Retain the supplied brief or existing manuscript voice; do not invent a company tone.'}\n\n`
    + 'Keep source claims, product names, acronyms and qualifiers. Provisional voice stays provisional. Design choices do not determine language.\n';
  return { design, voice };
}

/** deck-direction.json: the machine-readable look for callers. */
export function deckDirectionFile(c) {
  const deck = c.design.slides?.deck;
  if (!deck) return null;
  const { directions, ...chosen } = deck;
  return { schema: 1, identity: c.identity, contractRevision: c.revision, ...chosen, directions };
}

/** Write the contract's files into `output`, a new folder whose parent exists. */
export async function exportContract(chosen, options) {
  const contract = await buildContract(chosen, options);
  const output = resolve(options.output);
  const views = contractViews(contract);
  const deck = deckDirectionFile(contract);
  mkdirSync(output, { mode: 0o700 });
  try {
    for (const [name, value] of [['brand-contract.json', `${JSON.stringify(contract, null, 2)}\n`], ['DESIGN.md', views.design],
      ['VOICE.md', views.voice], ...(deck ? [['deck-direction.json', `${JSON.stringify(deck, null, 2)}\n`]] : [])]) {
      writeFileSync(join(output, name), value, { flag: 'wx', mode: 0o600 });
    }
  } catch (error) {
    rmSync(output, { recursive: true, force: true });
    throw error;
  }
  return { output, revision: contract.revision, identity: contract.identity, medium: contract.medium,
    authorVoice: contract.language.authorVoice.status,
    ...(deck ? { deckDirection: join(output, 'deck-direction.json'), defaultDirection: deck.default } : {}) };
}
