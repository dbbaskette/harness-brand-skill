// Reading a pack's layouts.json, refusing in a sentence one that cannot be used.
import { readFileSync } from 'node:fs';

const object = (value) => value !== null && typeof value === 'object' && !Array.isArray(value);

/** layouts.json as written before, or a refusal: one that cannot be read is never replaced. */
export function readLayouts(file) {
  let value;
  try {
    value = JSON.parse(readFileSync(file, 'utf8'));
  } catch (error) {
    throw new Error(`${file} cannot be read as JSON (${error.message}). Nothing was written.`);
  }
  const fine = object(value) && value.schema === 1 && object(value.variants)
    && Object.values(value.variants).every((variant) => object(variant) && Array.isArray(variant.layouts)
      && variant.layouts.every(object) && (variant.slides === undefined || Array.isArray(variant.slides)));
  if (!fine) {
    throw new Error(`${file} is not a layouts.json this command can read (it needs "schema": 1 and variants, each with a list `
      + 'of layouts). Nothing was written.');
  }
  return value;
}
