import { readFileSync } from 'node:fs';

export const VERSION = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8')).version;

export function main() {
  console.log(`Harness Brand ${VERSION}`);
  return 0;
}
