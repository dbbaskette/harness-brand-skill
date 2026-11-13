// harness-brand presentation: the brand audit of a finished PowerPoint deck.
import { existsSync } from 'node:fs';
import { parseArgs } from 'node:util';
import { choose, dataFolder } from './lib/worker/brands.mjs';
import { auditDeck } from './lib/worker/audit.mjs';

export function main(args) {
  const refuse = (message) => { throw Object.assign(new Error(message), { exitCode: 2 }); };
  let values;
  try {
    ({ values } = parseArgs({ args, options: { brand: { type: 'string' }, variant: { type: 'string' }, file: { type: 'string' },
      json: { type: 'boolean', default: false }, strict: { type: 'boolean', default: false } } }));
  } catch (error) {
    refuse(error.message);
  }
  if (!values.file || !values.file.toLowerCase().endsWith('.pptx')) refuse('--file requires a .pptx path');
  if (!existsSync(values.file)) refuse(`There is no deck at ${values.file}.`);
  if (!values.brand) refuse('Give --brand: the audit never guesses the deck\'s brand.');
  let report;
  try {
    report = auditDeck(values.file, choose(dataFolder(), values.brand, values.variant));
  } catch (error) {
    refuse(error.message);
  }
  if (values.json) {
    console.log(JSON.stringify(report, null, 2));
  } else {
    console.log(`${report.status}: ${report.blockers.length} blocker${report.blockers.length === 1 ? '' : 's'}, ${report.warnings.length} warning${report.warnings.length === 1 ? '' : 's'}, ${report.slides.length} slides.`);
    for (const each of [...report.blockers, ...report.warnings]) console.log(`  slide ${each.slide}: ${each.ruleId}: ${each.remediation}`);
  }
  if (report.blockers.length) return 2;
  return values.strict && report.warnings.length ? 1 : 0;
}
