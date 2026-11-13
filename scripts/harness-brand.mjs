#!/usr/bin/env node
// Harness Brand: brand packs and icon libraries for the studios' slides, blogs and infographics.
import { USAGE as PACK } from './pack.mjs';

const COMMANDS = { rebrand: './rebrand.mjs', version: './version.mjs', brands: './brands.mjs', contract: './contract.mjs', layouts: './layouts.mjs', icons: './icons.mjs',
  doctor: './doctor.mjs', data: './data.mjs', presentation: './presentation.mjs', guidance: './guidance.mjs', look: './look.mjs', pack: './pack.mjs' };

const USAGE = `Usage: harness-brand <command> [options]

  version
  rebrand setup [--brand ID] [--replace-brand-shortcuts]
  rebrand run SOURCE --brand ID [--review] [--template-plan FILE]
  rebrand status --brand ID
  brands [--json]
  contract export --medium slides|blog --brand B [--variant V] [--delivery live|reading] [--voice-profile FILE] --output NEW_DIR
  contract check --file brand-contract.json
  layouts --brand B [--variant V] [--query WORDS | --id ID] [--relationship R] [--all] [--json]
  icons --query WORDS [--brand B [--variant V]] [--limit 1-20] [--json]
  presentation --brand B [--variant V] --file deck.pptx [--json] [--strict]
  guidance start|resume --skill slides --project DIR [--task ID] [--brand B [--variant V]]
  look samples --brand B [--variant V] [--delivery live|reading] --outline outline.json --output NEW_DIR [--preview google|local]
  look choose --samples DIR --choice ID --words "<the person's words>" [--outline outline.json --write NEW_OUTLINE] [--unrendered]
  look status --samples DIR
  doctor [--profile presentation] [--format pptx] [--json]
${PACK}

  data [--set FOLDER | --install FOLDER] [--json]

Harness Brand: brand packs and icon libraries for the studios. It never changes the brands it
reads; pack commands write only into the pack or library folder you give them. The brand
commands read the brands folder named by --data FOLDER, else HARNESS_BRAND_DATA, else the
folder \`harness-brand data --set\` recorded, else the local brands folder that
\`harness-brand data --install\` copies brands into.`;

const given = process.argv.slice(2);
const at = given.indexOf('--data');
if (at >= 0) {
  // --data names the brands folder for this one command, wherever it is given.
  if (!given[at + 1]) { console.error('Give --data FOLDER, the brands folder.'); process.exit(2); }
  process.env.HARNESS_BRAND_DATA = given[at + 1];
  given.splice(at, 2);
}
const [command, ...rest] = given;
if (!command || command === '--help' || command === 'help') {
  console.log(USAGE);
  process.exit(0);
}
if (!Object.hasOwn(COMMANDS, command)) {
  console.error(`${command} is not a Harness Brand command.\n${USAGE}`);
  process.exit(2);
}
try {
  const { main } = await import(COMMANDS[command]);
  process.exitCode = await main(rest);
} catch (error) {
  const reasons = { EEXIST: 'something else is already there', ENOTDIR: 'part of that path is a file, not a folder',
    EISDIR: 'it is a folder, not a file', EACCES: 'permission was refused', EPERM: 'permission was refused',
    ENOENT: 'it does not exist', ENOSPC: 'the disk is full' };
  const reason = reasons[error.code];
  console.error(reason ? `Could not use ${error.dest ?? error.path ?? 'a file'}: ${reason}.` : error.message);
  process.exitCode = error.exitCode ?? 1;
}
