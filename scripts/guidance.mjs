// harness-brand guidance: Harness Slides' public slide guidance for a deck, started or resumed in
// the deck's project, with the brand's own entry, review guide, checkpoints and, once a brand is
// named, the worker guidance a studio forwards to every composer unchanged.
import { fileURLToPath } from 'node:url';
import { parseArgs } from 'node:util';
import { choose, dataFolder } from './lib/worker/brands.mjs';
import { buildContract } from './lib/worker/contract.mjs';
import { findSlides, slidesModule } from './lib/worker/slides.mjs';
import { workerText } from './lib/worker/looks.mjs';

const USAGE = 'Usage: harness-brand guidance start|resume --skill slides --project DIR [--task ID] [--brand BRAND [--variant VARIANT]]';
const path = (relative) => fileURLToPath(new URL(`../${relative}`, import.meta.url));
const CLI = path('scripts/harness-brand.mjs');

export const CHECKPOINTS = [
  'Intake, once, before the draft: the brand, live talk or handout (default live for a presentation), and the research offer.',
  'Draft approval: the person approves what the deck says, reviewed as a whole; per-slide design helpers only on an explicit walkthrough request or in a studio design session.',
  'Look: the person picks one of the rendered look samples before the first build, unless an approved direction for this deck is supplied. With no way to render, use the default direction, choose with --unrendered and call the deck an unreviewed draft.',
  'Final acceptance: the person accepts the rendered native deck after the brand audit and review.',
];

async function brandBlock(chosen) {
  const brands = dataFolder();
  const data = brands ? ` --data "${brands}"` : '';
  const brand = chosen ? `--brand ${chosen.id} --variant ${chosen.variant}` : '--brand BRAND';
  const block = {
    entry: path('references/harness-slides.md'),
    review: path('references/slide-review.md'),
    commands: {
      contract: `node "${CLI}" contract export --medium slides ${brand} --delivery live|reading --output NEW_DIR${data}`,
      icons: `node "${CLI}" icons ${brand} --query "<concept>" --limit 3${data}`,
      layouts: `node "${CLI}" layouts ${brand}${data}`,
      look: `node "${CLI}" look samples ${brand} --outline outline.json --output NEW_DIR [--preview google|local]${data}; then node "${CLI}" look choose --samples DIR --choice ID --words "<the person's words>" --outline outline.json --write NEW_OUTLINE [--unrendered]`,
      audit: `node "${CLI}" presentation ${brand} --file deck.pptx --json${data}`,
    },
    checkpoints: CHECKPOINTS,
    instructions: 'Read entry first. A studio may host these checkpoints in its own interface; Harness Brand defines them and none is skipped. Forward worker unchanged to every composer: it carries the brand direction, composer rules and icon search.',
  };
  if (!chosen) return { ...block, select: 'Name the deck\'s brand with --brand BRAND [--variant VARIANT] to receive the worker guidance and deck direction. Harness Brand assumes none.' };
  const contract = await buildContract(chosen, { medium: 'slides' });
  return { ...block, recipes: contract.design.references.guide, identity: contract.identity, deckDirection: contract.design.slides.deck,
    worker: workerText(contract) };
}

export async function main(args) {
  const { values, positionals } = parseArgs({ args, allowPositionals: true, options: { skill: { type: 'string' }, project: { type: 'string' },
    task: { type: 'string' }, brand: { type: 'string' }, variant: { type: 'string' } } });
  const [action, ...extra] = positionals;
  if (!action) {
    console.log(`${USAGE}\nStarts or resumes Harness Slides' public guidance in the deck's project. With --brand, the result carries the brand's worker guidance and deck direction.`);
    return 0;
  }
  if (extra.length || !['start', 'resume'].includes(action) || values.skill !== 'slides') throw new Error(`Choose guidance start or resume, with --skill slides.\n${USAGE}`);
  if (!values.project || (action === 'resume') !== Boolean(values.task)) throw new Error(`Give --project, and --task only with resume.\n${USAGE}`);
  if (values.variant && !values.brand) throw new Error('--variant needs --brand.');
  // An unknown brand is refused before any guidance task starts.
  const chosen = values.brand ? choose(dataFolder(), values.brand, values.variant) : null;
  if (chosen && !chosen.brand.variants[chosen.variant].slides) throw new Error(`The ${chosen.name} brand has no slides.`);
  const { root } = findSlides();
  const helper = await slidesModule('scripts/sync-guidance.mjs');
  const result = action === 'start' ? await helper.start({ project: values.project, runtime: root })
    : await helper.resume({ project: values.project, task: values.task, runtime: root });
  result.brand = await brandBlock(chosen);
  console.log(JSON.stringify(result, null, 2));
  return 0;
}
