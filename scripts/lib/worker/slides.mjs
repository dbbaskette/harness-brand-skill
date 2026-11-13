// Finding the separately installed Harness Slides, whose own modules give a brand contract its
// revision and check it. Nothing is fetched or installed here.
import { existsSync, readFileSync, realpathSync } from 'node:fs';
import { homedir } from 'node:os';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

const SOURCES = JSON.parse(readFileSync(new URL('../harness-install-sources.json', import.meta.url), 'utf8'));
export const MINIMUM = SOURCES.slides.minimumVersion ?? SOURCES.slides.version;
const REPOSITORY = 'https://github.com/dbbaskette/harness-slides-skill';

export const older = (version, minimum) => {
  const a = String(version).split('.').map(Number);
  const b = String(minimum).split('.').map(Number);
  for (let i = 0; i < 3; i += 1) if ((a[i] ?? 0) !== (b[i] ?? 0)) return (a[i] ?? 0) < (b[i] ?? 0);
  return false;
};

/** The places Harness Slides is looked for: HARNESS_SLIDES_ROOT alone when set, else the
 *  skills folders of each assistant. */
export function slidesPlaces({ home = homedir(), environment = process.env } = {}) {
  if (environment.HARNESS_SLIDES_ROOT) return [resolve(environment.HARNESS_SLIDES_ROOT)];
  return [join(home, '.agents', 'skills', 'harness-slides'),
    join(environment.CLAUDE_CONFIG_DIR || join(home, '.claude'), 'skills', 'harness-slides'),
    join(home, '.cursor', 'skills', 'harness-slides'),
    join(environment.CODEX_HOME || join(home, '.codex'), 'skills', 'harness-slides')];
}

/** {root, version} of the Harness Slides to use, or a refusal. One named by HARNESS_SLIDES_ROOT
 *  is used as given; one found must be at least MINIMUM. */
export function findSlides(options = {}) {
  const named = Boolean((options.environment ?? process.env).HARNESS_SLIDES_ROOT);
  let tooOld = null;
  for (const place of slidesPlaces(options)) {
    try {
      const root = realpathSync(place);
      const pkg = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8'));
      if (pkg.name !== 'harness-slides' || !existsSync(join(root, 'scripts', 'harness-slides.mjs'))) continue;
      if (!named && older(pkg.version, MINIMUM)) { tooOld ??= pkg.version; continue; }
      return { root, version: pkg.version };
    } catch {
      // Not there, or not readable: try the next place.
    }
  }
  if (named) throw new Error(`HARNESS_SLIDES_ROOT names ${slidesPlaces(options)[0]}, which does not hold Harness Slides. Point it at an installed one, or unset it.`);
  if (tooOld) throw new Error(`The installed Harness Slides is ${tooOld}; Harness Brand needs ${MINIMUM} or later. Update it with its own installer from ${REPOSITORY}.`);
  throw new Error(`Harness Brand needs Harness Slides ${MINIMUM} or later, and none is installed. Install it from ${REPOSITORY}, or set HARNESS_SLIDES_ROOT.`);
}

/** One of Harness Slides' own modules, such as scripts/lib/brand-contract.mjs. */
export async function slidesModule(name, options) {
  if (!/^scripts\/[\w./-]+\.mjs$/.test(name) || name.split('/').includes('..')) throw new Error(`${name} is not a Harness Slides module.`);
  const { root, version } = findSlides(options);
  if (!existsSync(join(root, name))) throw new Error(`The Harness Slides at ${root} (${version}) has no ${name}; update it to ${MINIMUM} or later.`);
  return import(pathToFileURL(join(root, name)).href);
}
