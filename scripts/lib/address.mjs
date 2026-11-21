// The one address Harness Brand gives out for itself.
// The installer keeps a release in <shared>/versions/<id> and points <shared>/current at the one in use; an
// update installs a new folder, moves the pointer and removes the old folder. Node resolves links before it runs a
// script, so this code sees itself in the version folder. Anything handed to a caller or written into a project
// names <shared>/current instead, which keeps working after an update. A source checkout, or a copy the pointer
// does not select, is itself.
import { lstatSync, realpathSync } from 'node:fs';
import { basename, dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

/** {root, shared}: the address to give out for the Harness Brand in `folder`, and the shared place it is
 *  installed in (null when it is not the installed copy). */
export function addressOf(folder) {
  const actual = realpathSync(folder);
  const versions = dirname(actual);
  if (basename(versions) !== 'versions') return { root: actual, shared: null };
  const shared = dirname(versions);
  const current = join(shared, 'current');
  try {
    if (lstatSync(current).isSymbolicLink() && realpathSync(current) === actual) return { root: current, shared };
  } catch { /* No pointer selects this copy. */ }
  return { root: actual, shared: null };
}

const OWN = addressOf(fileURLToPath(new URL('../..', import.meta.url)));

/** This Harness Brand's folder, as callers are given it. */
export const ROOT = OWN.root;
/** The shared place this Harness Brand is installed in, or null in a checkout. */
export const SHARED = OWN.shared;
/** Its command, named in full in every command a worker is told to run. */
export const CLI = join(ROOT, 'scripts', 'harness-brand.mjs');
/** One of its own files, such as references/harness-slides.md. */
export const place = (relative) => join(ROOT, relative);

const VERSIONED = /"[^"\n]*[\\/]versions[\\/][^"\n\\/]+[\\/]scripts[\\/]harness-brand\.mjs"/g;

/** Text written by an earlier installed version names that version's folder in its commands, and an update removes
 *  the folder. The same text with those commands naming this Harness Brand. */
export const repointCommands = (text) => String(text).replace(VERSIONED, () => `"${CLI}"`);

/** The version folders of Harness Brand that commands in `text` name, such as a contract exported before 1.4.0. */
export function versionedCommands(text) {
  return [...new Set((String(text).match(VERSIONED) ?? []).map((each) => each.slice(1, -1)))];
}
