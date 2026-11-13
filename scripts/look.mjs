// harness-brand look samples | choose | status: the look step without chat.
import { parseArgs } from 'node:util';
import { choose, dataFolder } from './lib/worker/brands.mjs';
import { chooseLook, lookSamples, lookStatus } from './lib/worker/looks.mjs';

const ALLOWED = {
  samples: ['brand', 'variant', 'delivery', 'outline', 'output', 'slide', 'preview', 'icons'],
  choose: ['samples', 'choice', 'words', 'words-file', 'outline', 'write', 'unrendered'],
  status: ['samples'],
};

export async function main(args) {
  const { positionals, values } = parseArgs({ args, allowPositionals: true, strict: false, options: {
    ...Object.fromEntries([...ALLOWED.samples, ...ALLOWED.choose].filter((key) => key !== 'unrendered').map((key) => [key, { type: 'string' }])),
    unrendered: { type: 'boolean' } } });
  const [action, ...extra] = positionals;
  if (extra.length || !ALLOWED[action]) throw new Error('Use look samples|choose|status');
  const unknown = Object.keys(values).filter((key) => !ALLOWED[action].includes(key));
  if (unknown.length) throw new Error(`look ${action} does not take --${unknown.join(', --')}`);
  const bare = Object.entries(values).find(([key, value]) => key !== 'unrendered' && typeof value !== 'string');
  if (bare) throw new Error(`Give a value for --${bare[0]}.`);
  let result;
  if (action === 'samples') {
    const chosen = choose(dataFolder(), values.brand, values.variant);
    if (!chosen.brand.variants[chosen.variant].slides) throw new Error(`The ${chosen.name} brand has no slides, so no looks.`);
    result = await lookSamples(chosen, values);
  } else if (action === 'choose') {
    result = await chooseLook({ ...values, wordsFile: values['words-file'] });
  } else {
    result = await lookStatus(values);
  }
  console.log(JSON.stringify(result, null, 2));
  return 0;
}
