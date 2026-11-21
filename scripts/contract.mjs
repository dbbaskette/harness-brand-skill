// harness-brand contract export | check: the brand contract a studio hands Harness Slides or a
// blog writer, and the check that the pack it came from is unchanged.
import { existsSync, readFileSync } from 'node:fs';
import { parseArgs } from 'node:util';
import { CLI, versionedCommands } from './lib/address.mjs';
import { choose, dataFolder } from './lib/worker/brands.mjs';
import { exportContract } from './lib/worker/contract.mjs';
import { restoreDeck } from './lib/worker/icons.mjs';
import { slidesModule } from './lib/worker/slides.mjs';

const OPTIONS = { export: ['brand', 'variant', 'medium', 'delivery', 'voice-profile', 'output'], check: ['file'] };

const strings = (value) => (typeof value === 'string' ? [value] : value && typeof value === 'object' ? Object.values(value).flatMap(strings) : []);

/** A contract exported before 1.4.0 names the folder of the version that exported it in its
 *  commands, and an update removes that folder. Its content still stands, so it passes; the
 *  notice names the one command that exports it again with commands that keep working. */
function staleCommands(contract) {
  const gone = versionedCommands(strings(contract).join('\n')).filter((path) => !existsSync(path));
  if (!gone.length) return null;
  const { identity = {}, medium = {} } = contract;
  const voice = (contract.sources ?? []).find((each) => each?.kind === 'selected author voice')?.path;
  return `The commands in this contract name ${gone[0]}, a Harness Brand version that is no longer installed. Export it again: `
    + `node "${CLI}" contract export --medium ${medium.kind} --brand ${identity.id} --variant ${identity.variant}`
    + `${medium.kind === 'slides' ? ` --delivery ${medium.delivery}` : ''}${voice ? ` --voice-profile "${voice}"` : ''} --output NEW_DIR`;
}

export async function main(args) {
  const { positionals, values } = parseArgs({ args, allowPositionals: true, strict: false,
    options: Object.fromEntries([...OPTIONS.export, ...OPTIONS.check].map((key) => [key, { type: 'string' }])) });
  const action = positionals[0];
  if (!OPTIONS[action]) throw new Error('Use contract export|check');
  const bare = Object.entries(values).find(([key, value]) => OPTIONS[action].includes(key) && typeof value !== 'string');
  if (bare) throw new Error(`Give a value for --${bare[0]}.`);
  if (Object.keys(values).some((key) => !OPTIONS[action].includes(key))) throw new Error('Unsupported contract option');
  if (positionals.length !== 1) throw new Error('Use contract export|check');
  let result;
  if (action === 'export') {
    if (!values.output) throw new Error('Choose a new output directory');
    const chosen = choose(dataFolder(), values.brand, values.variant);
    result = await exportContract(chosen, { medium: values.medium ?? 'slides', delivery: values.delivery ?? 'reading',
      voiceProfile: values['voice-profile'], output: values.output });
  } else {
    if (!values.file) throw new Error('Give --file, the brand-contract.json to check.');
    const contract = JSON.parse(readFileSync(values.file, 'utf8'));
    // An icon deck is kept in a cache that may have been cleared: it is made again, the same bytes, from its pack.
    for (const each of Array.isArray(contract.sources) ? contract.sources : []) {
      if (['icon library', 'icon index'].includes(each?.kind) && typeof each.path === 'string') restoreDeck(dataFolder(), each.path);
    }
    const { checkBrandSources } = await slidesModule('scripts/lib/brand-contract.mjs');
    result = await checkBrandSources(contract);
    const notice = staleCommands(contract);
    if (notice) result.notice = notice;
  }
  console.log(JSON.stringify(result, null, 2));
  return 0;
}
