// The look step without chat: one outline slide drawn in each of the brand's deck directions,
// for the person to pick from, and their pick recorded in their own words and carried into the
// outline. Harness Slides checks the outline, compiles and renders each sample.
import { randomUUID, createHash } from 'node:crypto';
import { link, mkdir, open, readFile, rm, unlink, writeFile } from 'node:fs/promises';
import { basename, dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { contrast } from '../pack/check.mjs';
import { dataFolder } from './brands.mjs';
import { buildContract } from './contract.mjs';
import { librariesOf, searchIcons } from './icons.mjs';
import { findSlides, slidesModule } from './slides.mjs';

const sha = (bytes) => createHash('sha256').update(bytes).digest('hex');
const text = (value) => typeof value === 'string' && value.trim().length > 0;
const lower = (value) => String(value ?? '').toLowerCase();
const CLI = fileURLToPath(new URL('../../harness-brand.mjs', import.meta.url));
const q = JSON.stringify;

/** Write a new file without ever replacing one (EEXIST if it is taken). */
async function writeNew(path, data) {
  const temp = join(dirname(path), `.${basename(path)}.${randomUUID()}.tmp`);
  await writeFile(temp, data, { flag: 'wx', mode: 0o600 });
  try { await link(temp, path); } finally { await unlink(temp); }
}
const houseOf = (plan) => (plan?.house === undefined ? [] : typeof plan.house === 'string' ? [plan.house] : plan.house);
const normalised = (plan) => (plan?.house === undefined ? plan : { ...plan, house: houseOf(plan) });

/** The worker guidance a studio forwards unchanged to every composer. */
export function workerText(contract) {
  const deck = contract.design.slides.deck;
  const { id, name, variant } = contract.identity;
  const brands = dataFolder();
  const data = brands ? ` --data "${brands}"` : '';
  return `# ${name} slides: worker guidance\n\nThe brand's guidance for composing slides; follow it together with the Harness Slides guidance. The brand's rules and slide recipes: ${contract.design.references.guide}. Icon search: node "${CLI}" icons --brand ${id} --variant ${variant} --query "<concept>" --limit 3${data}.\n\n`
    + '## Look\n\nUse the outline\'s `direction`, `house` and `layouts` (set by the look choice); never pick or sample a look yourself.\n\n'
    + `${deck.fills}\n\n## Composer rules\n\n${deck.house.map((line) => `- ${line}`).join('\n')}\n\n`
    + `## Lead slides\n\nCover, section and closing slides use the outline's \`layouts\`; never the content layout. The closing layout shows a title${deck.closing.thanks ? '; a thanks-only closing uses the thank-you layout a house line names, whose artwork already says Thank You and shows no title' : ''}. List every layout with node "${CLI}" layouts --brand ${id} --variant ${variant}${data}.\n`;
}

/** The slide that shows a look best: the named one, else the first content slide with a point
 *  to mark and a relation to draw. */
export function lookSlide(outline, id) {
  const content = (outline?.slides ?? []).filter((s) => s?.kind === 'content');
  if (id) {
    const found = content.find((s) => s.id === id);
    if (!found) throw new Error(`No content slide ${id} in the outline`);
    return found;
  }
  const drawn = content.filter((s) => s.relation && s.relation !== 'none' && (s.points ?? []).length >= 2);
  const chosen = drawn.find((s) => s.focal) ?? drawn[0] ?? content[0];
  if (!chosen) throw new Error('The outline has no content slide to show a look on');
  return chosen;
}

const STOP = new Set(['the', 'and', 'for', 'with', 'from', 'that', 'this', 'what', 'your', 'their', 'into', 'over', 'team', 'plan']);
/** The best icon for a point's words, from the brand's libraries, or null. */
function iconFor(words, brands, libraries) {
  for (const word of lower(words).split(/[^a-z0-9]+/).filter((each) => each.length >= 4 && !STOP.has(each))) {
    const { results } = searchIcons(brands, libraries, word, { limit: 1 });
    if (results[0]) return results[0].id;
  }
  return null;
}

/** What a fallback attempt removed: the key only if there was one, icons only if any were placed. */
export const droppedFor = (attempt, { key, icons, relation }) => [...(attempt >= 1 && key ? ['key'] : []), ...(attempt >= 2 && icons ? ['icons'] : []),
  ...(attempt >= 3 && relation !== 'parallel' ? ['relation'] : [])];

/** One sample composition: the slide's real title, points and caveat, drawn in one direction. */
export function sampleComposition(slide, entry, colors, { icons = null, legend = true, relation, stripOnly = [] } = {}) {
  const d = entry.direction;
  const points = (slide.points ?? []).slice(0, 6);
  const focalIndex = points.findIndex((p) => slide.focal && lower(p.label) === lower(slide.focal));
  const words = (p) => ` ${lower(`${p.label ?? ''} ${p.text ?? ''}`).replace(/[^a-z0-9]+/g, ' ')} `;
  const meaningOf = (p) => Object.entries(entry.cues ?? {}).find(([, cues]) => cues.some((c) => words(p).includes(` ${c} `)))?.[0];
  // Status meanings, and colours the brand keeps text off, tag a card with a strip; they never fill a text-bearing panel.
  const isStatus = (role) => /^status/.test(role) || /risk|caution/i.test(d.meanings?.[role] ?? '') || stripOnly.includes(role);
  const onFill = (role) => (contrast(colors[role], colors.canvasPrimary) > contrast(colors[role], colors.inkDeep) ? 'canvasPrimary' : 'inkDeep');
  const cards = points.map((p, i) => {
    const id = `look_card_${i + 1}`;
    const focal = i === focalIndex;
    const role = focal ? null : meaningOf(p);
    const icon = icons?.[i];
    const parts = [...(p.label ? [{ type: 'text', id: `${id}_h`, text: p.label, textRole: 'label' }] : []), ...(p.text ? [{ type: 'text', id: `${id}_t`, text: p.text }] : [])];
    const body = icon ? [{ type: 'stack', direction: 'row', gap: 'normal', align: 'start', children: [
      { type: 'icon', id: `${id}_i`, icon, style: 'outline', color: focal ? onFill(d.focal) : role && !isStatus(role) ? onFill(role) : 'inkDeep' },
      { type: 'stack', direction: 'column', gap: 'tight', weight: 5, children: parts }] }] : parts;
    return { type: 'box', id, ...(focal ? {} : role ? { fill: role, ...(isStatus(role) ? { style: 'bar' } : {}) } : { style: 'bar' }), children: body };
  });
  const how = relation ?? slide.relation;
  const joined = ['order', 'dependency'].includes(how);
  const main = how === 'quantity' && points[0]?.label
    ? { type: 'stack', direction: 'row', gap: 'wide', children: [{ type: 'metric', id: 'look_metric', value: points[0].label, label: points[0].text ?? '' }, ...cards.slice(1)] }
    : cards.length > 3 && !joined ? { type: 'grid', columns: cards.length === 4 ? 2 : 3, children: cards } : { type: 'stack', direction: 'row', gap: 'wide', children: cards };
  const statement = slide.focal && focalIndex < 0 ? { type: 'box', id: 'look_focal', text: slide.focal } : null;
  // A quiet key: one line of small chips for the meanings this sample actually uses.
  const used = [...new Set(cards.map((c) => c.fill).filter(Boolean))];
  const key = legend && used.length ? { type: 'stack', id: 'look_key', direction: 'row', gap: 'tight', weight: 0.1, children: [
    ...used.flatMap((role, i) => [{ type: 'box', id: `look_key_swatch_${i + 1}`, fill: role, weight: 0.3 },
      { type: 'text', id: `look_key_label_${i + 1}`, text: entry.keys?.[role] ?? d.meanings[role].split(':')[0], textRole: 'caption', color: 'inkDeep', weight: 1.8 }]),
    { type: 'spacer', weight: Math.max(0.5, 10.8 - used.length * 2.1) }] } : null;
  const canvas = statement || key ? { type: 'stack', direction: 'column', gap: 'normal', children: [...(statement ? [statement] : []), { ...main, weight: 10 }, ...(key ? [key] : [])] } : main;
  const brief = { relation: how === 'quantity' && !points[0]?.label ? 'parallel' : how,
    ...(focalIndex >= 0 ? { focal: `look_card_${focalIndex + 1}` } : statement ? { focal: 'look_focal' } : {}) };
  const connect = joined ? cards.slice(1).map((c, i) => ({ id: `look_edge_${i + 1}`, from: cards[i].id, to: c.id, arrow: true })) : undefined;
  return { version: 1, title: `Look sample: ${entry.name}`, direction: d, slides: [{ id: 'look_sample', title: slide.title,
    sources: slide.sources?.length ? slide.sources : ['request'], brief, canvas, ...(connect ? { connect } : {}),
    ...(slide.caveat ? { caveat: slide.caveat } : {}), ...(slide.source ? { source: slide.source } : {}) }] };
}

const RENDER_ADVICE = 'Render each sample with its next.render command: google uses Harness Slides\' Google preview (ask the person once whether Google previews are fine), local needs LibreOffice installed. Then show the images with each look\'s name and wait for the person.';
const PNG = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
async function isPng(path) {
  let handle;
  try {
    handle = await open(path, 'r');
    const head = Buffer.alloc(8);
    await handle.read(head, 0, 8, 0);
    return head.equals(PNG);
  } catch { return false; } finally { await handle?.close(); }
}

/** The image a person saw for a sample: only a Harness Slides preview of that sample's own build counts. */
export async function sampleImage(sample) {
  const folder = join(dirname(sample.pptx), 'preview');
  const preview = await readFile(join(folder, 'preview.json'), 'utf8').then(JSON.parse, () => null);
  if (!preview?.buildBinding || typeof preview.slides?.[0]?.image !== 'string') return null;
  const { compositionBinding } = await slidesModule('scripts/lib/composition-project.mjs');
  if (await compositionBinding(sample.build).catch(() => null) !== preview.buildBinding) return null;
  const image = resolve(folder, preview.slides[0].image);
  return (await isPng(image)) ? image : null;
}

/** Draw one outline slide in each of the brand's directions into `output`, a new folder. */
export async function lookSamples(chosen, { delivery, outline, output, slide: slideId, preview, icons = 'auto' }) {
  if (!outline || !output) throw new Error('Use look samples --brand BRAND --outline outline.json --output NEW_DIR');
  if (!['auto', 'none'].includes(icons)) throw new Error('Choose --icons auto|none');
  if (preview && !['local', 'google'].includes(preview)) throw new Error('Choose --preview local|google, or leave it out for native decks only');
  output = resolve(output);
  const outlineBytes = await readFile(outline);
  const plan = normalised(JSON.parse(outlineBytes));
  const contract = await buildContract(chosen, { medium: 'slides', delivery: delivery ?? plan?.delivery ?? 'reading' });
  const deck = contract.design.slides.deck;
  const { checkOutline } = await slidesModule('scripts/lib/outline.mjs');
  await checkOutline(plan, contract);
  const slide = lookSlide(plan, slideId);
  const { compileCompositionFile, renderCompositionDir } = await slidesModule('scripts/lib/compose-file.mjs');
  const brands = dirname(dirname(chosen.pack));
  const libraries = librariesOf(chosen.brand);
  const iconIds = icons === 'auto' && libraries.length && contract.design.slides.icon.library
    ? (slide.points ?? []).slice(0, 6).map((p) => iconFor(`${p.label ?? ''} ${p.text ?? ''}`, brands, libraries)) : null;
  await mkdir(dirname(output), { recursive: true });
  try { await mkdir(output, { mode: 0o700 }); } catch (error) {
    if (error.code === 'EEXIST') throw new Error(`Look samples output ${output} exists; choose a new directory`);
    throw error;
  }
  try {
    const brandFile = join(output, 'brand-contract.json');
    await writeFile(brandFile, `${JSON.stringify(contract, null, 2)}\n`, { flag: 'wx', mode: 0o600 });
    const samples = [];
    for (const entry of deck.directions) {
      const dir = join(output, entry.id);
      await mkdir(dir, { mode: 0o700 });
      // Fit first with everything, then without the key, then without icons, then as plain peers.
      const attempts = [{}, { legend: false }, { legend: false, icons: null }, { legend: false, icons: null, relation: 'parallel' }];
      let built;
      let composition;
      let dropped = [];
      let last;
      for (const [n, attempt] of attempts.entries()) {
        composition = sampleComposition(slide, entry, contract.design.colors, { icons: iconIds, stripOnly: deck.stripOnly, ...attempt });
        const file = join(dir, `composition-${n + 1}.json`);
        await writeFile(file, `${JSON.stringify(composition, null, 2)}\n`, { flag: 'wx', mode: 0o600 });
        try {
          built = await compileCompositionFile({ file, brand: brandFile, output: join(dir, `build-${n + 1}`), project: output });
          composition.file = file;
          composition.build = built.output;
          const first = sampleComposition(slide, entry, contract.design.colors, { icons: iconIds, stripOnly: deck.stripOnly });
          dropped = droppedFor(n, { key: JSON.stringify(first).includes('"look_key"'), icons: Boolean(iconIds?.some(Boolean)), relation: slide.relation });
          break;
        } catch (error) { last = error; }
      }
      if (!built) throw new Error(`${entry.id}: the sample slide does not fit: ${last.message}`);
      const pptx = join(dir, 'look.pptx');
      await renderCompositionDir({ file: composition.build, output: pptx });
      let image = null;
      if (preview) {
        const { previewComposition } = await slidesModule('scripts/lib/compose-preview.mjs');
        const shown = await previewComposition({ file: composition.build, output: join(dir, 'preview'), renderer: preview, project: output });
        image = shown.slides?.[0]?.image ?? join(dir, 'preview', 'slide-01.png');
      }
      samples.push({ id: entry.id, name: entry.name, useWhen: entry.useWhen, direction: entry.direction, layouts: entry.layouts,
        composition: composition.file, build: composition.build, pptx, image, ...(dropped.length ? { simplified: dropped } : {}) });
    }
    let sheet = null;
    if (preview && samples.every((s) => s.image)) {
      const { writeContactSheet } = await slidesModule('scripts/lib/contact-sheet.mjs');
      sheet = (await writeContactSheet(samples.map((s) => s.image), join(output, 'looks.png'))).path;
    }
    const manifest = { schema: 1, status: 'awaiting-choice', identity: contract.identity, contractRevision: contract.revision, outline: resolve(outline),
      outlineSha256: sha(outlineBytes), slide: slide.id, default: deck.default, look: deck.look, house: deck.house, preview: preview ?? null, samples, sheet,
      createdAt: new Date().toISOString() };
    await writeNew(join(output, 'looks.json'), `${JSON.stringify(manifest, null, 2)}\n`);
    const slidesCli = join(findSlides().root, 'scripts', 'harness-slides.mjs');
    const render = (sample, renderer) => `node ${q(slidesCli)} compose preview --file ${q(sample.build)} --output ${q(join(dirname(sample.pptx), 'preview'))} --renderer ${renderer}`;
    return { status: manifest.status, output, slide: slide.id, default: deck.default,
      samples: samples.map(({ id, name, pptx, image, simplified }) => ({ id, name, pptx, image, ...(simplified ? { simplified } : {}) })), sheet,
      next: { show: preview ? 'Show looks.png (or each image) with each look\'s name and what it is for, and wait for the person.' : RENDER_ADVICE,
        render: preview ? undefined : samples.map((s) => ({ id: s.id, google: render(s, 'google'), local: render(s, 'local') })),
        choose: `node ${q(CLI)} look choose --samples ${q(output)} --choice <id> --words "<what the person said>" --outline outline.json --write NEW_OUTLINE` } };
  } catch (error) {
    await rm(output, { recursive: true, force: true });
    throw error;
  }
}

/** Where a set of samples stands: chosen or awaiting a choice, and whether each was rendered. */
export async function lookStatus({ samples }) {
  if (!samples) throw new Error('Give --samples, the look samples folder.');
  const dir = resolve(samples);
  const manifest = JSON.parse(await readFile(join(dir, 'looks.json'), 'utf8'));
  const choice = await readFile(join(dir, 'choice.json'), 'utf8').then(JSON.parse, (error) => { if (error.code === 'ENOENT') return null; throw error; });
  const images = await Promise.all(manifest.samples.map(sampleImage));
  return { status: choice ? 'chosen' : manifest.status, slide: manifest.slide, default: manifest.default, shown: images.every(Boolean) ? 'rendered' : 'unrendered',
    samples: manifest.samples.map(({ id, name, pptx }, i) => ({ id, name, pptx, image: images[i] })), sheet: manifest.sheet, ...(choice ? { choice } : {}) };
}

/** Record the person's pick in their words, and carry it into a new outline. Only the refusal
 *  for an outline edited since the samples says "changed": studios take that word to mean that
 *  the samples must be drawn again. */
export async function chooseLook({ samples, choice, words, wordsFile, outline, write, unrendered = false }) {
  if (!samples || !choice) throw new Error('Give --samples, the look samples folder, and --choice, the look the person picked.');
  const dir = resolve(samples);
  const manifest = JSON.parse(await readFile(join(dir, 'looks.json'), 'utf8'));
  if (manifest?.schema !== 1 || !Array.isArray(manifest.samples) || !manifest.identity?.id) throw new Error(`${join(dir, 'looks.json')} is not a look samples record this release reads; take new samples`);
  if (wordsFile) words = await readFile(wordsFile, 'utf8');
  if (!text(words)) throw new Error('Record what the person said when they chose the look with --words or --words-file; a choice needs their words');
  const picked = manifest.samples.find((s) => s.id === choice);
  if (!picked) throw new Error(`${choice} is not one of the samples: ${manifest.samples.map((s) => s.id).join(', ')}`);
  const contract = JSON.parse(await readFile(join(dir, 'brand-contract.json'), 'utf8'));
  const colors = contract.design.colors;
  if (![picked.direction.focal, picked.direction.neutral, ...Object.keys(picked.direction.meanings ?? {})].every((role) => Object.hasOwn(colors, role))) {
    throw new Error(`${picked.id} uses a colour role the brand does not have; take new samples`);
  }
  if (await readFile(join(dir, 'choice.json')).then(() => true, () => false)) throw new Error('A look is already chosen for these samples; take new samples to choose again');
  if (Boolean(outline) !== Boolean(write)) throw new Error('Use --outline and --write together');
  const images = await Promise.all(manifest.samples.map(sampleImage));
  const shown = images.every(Boolean) ? 'rendered' : 'unrendered';
  if (shown === 'unrendered' && unrendered !== true) throw new Error(`These samples were not rendered; choose with --unrendered. ${RENDER_ADVICE} The deck is then an unreviewed draft.`);
  const thanks = picked.layouts.thanks;
  let updated = null;
  if (outline) {
    const bytes = await readFile(outline);
    if (sha(bytes) !== manifest.outlineSha256) throw new Error('The outline has changed since the samples were made; take new samples first');
    const plan = normalised(JSON.parse(bytes));
    const closingLine = thanks ? [`A thanks-only closing uses the template layout \`${thanks}\`; its artwork already says Thank You and shows no title.`] : [];
    const house = [...new Set([...houseOf(plan), ...manifest.house, ...closingLine])];
    updated = { ...plan, direction: picked.direction, house,
      layouts: { ...(plan.layouts ?? {}), cover: picked.layouts.cover, section: picked.layouts.section, closing: picked.layouts.closing },
      approval: [...(plan.approval ?? []), `Look chosen: ${picked.name} (${picked.id}), from ${shown === 'rendered' ? 'rendered samples' : 'samples that were not rendered (no preview was available)'}. In their words: "${words.trim()}"`] };
    const { checkOutline } = await slidesModule('scripts/lib/outline.mjs');
    await checkOutline(updated, contract);
  }
  const record = { schema: 1, choice: picked.id, name: picked.name, direction: picked.direction, layouts: picked.layouts, house: manifest.house, words: words.trim(),
    shown, identity: manifest.identity, contractRevision: manifest.contractRevision, outlineSha256: manifest.outlineSha256, outlineChecked: Boolean(updated),
    chosenAt: new Date().toISOString() };
  if (updated) await writeNew(resolve(write), `${JSON.stringify(updated, null, 2)}\n`);
  try { await writeNew(join(dir, 'choice.json'), `${JSON.stringify(record, null, 2)}\n`); } catch (error) {
    if (updated) await rm(resolve(write), { force: true });
    throw error;
  }
  return { status: 'chosen', choice: picked.id, name: picked.name, shown, direction: picked.direction, layouts: picked.layouts,
    closing: { withWords: picked.layouts.closing, ...(thanks ? { thanks } : {}) }, record: join(dir, 'choice.json'),
    ...(shown === 'unrendered' ? { unreviewed: 'Chosen without rendered samples: call the deck an unreviewed draft until its slides are rendered and reviewed.' } : {}),
    ...(updated ? { outline: resolve(write) } : { note: 'No outline was given, so nothing was checked for staleness; pass --outline and --write to carry the look into the outline.' }) };
}
