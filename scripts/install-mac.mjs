#!/usr/bin/env node
// Install Harness Brand on a Mac: the same install as install-skill.mjs, asking first unless
// given --yes. Marketing Studio runs it as: install-mac.mjs --yes --research skip.
import { spawnSync } from 'node:child_process';
import { realpathSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { run } from './install-skill.mjs';

/** Ask on the terminal; with no terminal, refuse rather than wait. */
function question(prompt) {
  if (!process.stdin.isTTY) throw new Error('Rerun with --yes to install without a question.');
  process.stdout.write(prompt);
  const answer = spawnSync('/bin/sh', ['-c', 'read -r line && printf %s "$line"'], { stdio: ['inherit', 'pipe', 'inherit'], encoding: 'utf8' });
  if (answer.status !== 0) throw new Error('Could not read the answer; nothing was installed.');
  return String(answer.stdout).trim();
}

if (process.argv[1] && realpathSync(resolve(process.argv[1])) === realpathSync(fileURLToPath(import.meta.url))) {
  try {
    process.exitCode = run(process.argv.slice(2), {
      confirm: () => /^y(es)?$/i.test(question('Install Harness Brand for Claude Code and Codex? [y/N] ')),
      askData: () => question('Brands folder (contains one folder per brand; Enter to set up later): '),
    });
  } catch (error) {
    console.error(error.message);
    process.exitCode = 1;
  }
}
