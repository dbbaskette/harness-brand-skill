// Sealing a finished pack: brand.json records the SHA-256 of itself, of every pack file and of
// every source file, so that a later check sees anything changed, gone or added since.
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { brandHash, checkPack, packFiles, sha256, sourceFiles } from './check.mjs';

/** brand.json for the pack in `pack` with its files and sources sealed, or a refusal that
 *  lists every problem when the pack does not pass. Nothing is written. */
export function sealPack(pack) {
  const problems = checkPack(pack, { hashes: false });
  if (problems.length) throw new Error(`The pack does not pass, so it was not sealed:\n${problems.map((each) => `  ${each}`).join('\n')}`);
  const brand = JSON.parse(readFileSync(join(pack, 'brand.json'), 'utf8'));
  const sealed = (folder, names) => Object.fromEntries(names.map((name) => [name, sha256(readFileSync(join(folder, name)))]));
  const { files: _files, sources: _sources, brandSha256: _brand, ...rest } = brand;
  return { ...rest, brandSha256: brandHash(rest), files: sealed(pack, packFiles(pack)),
    sources: sealed(join(dirname(pack), 'sources'), sourceFiles(pack)) };
}
