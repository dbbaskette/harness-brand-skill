import { test } from 'node:test';
import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';
import { crc32, readZip, writeZip } from '../scripts/lib/zip.mjs';

test('crc32 matches the standard check value', () => {
  assert.equal(crc32(Buffer.from('123456789')), 0xcbf43926);
});

test('files written are read back unchanged', () => {
  const noise = randomBytes(2048);   // does not compress, so it is stored
  const archive = writeZip([['a.txt', 'hello '.repeat(200)], ['b/c.bin', noise]]);
  const files = readZip(archive);
  assert.deepEqual([...files.keys()], ['a.txt', 'b/c.bin']);
  assert.equal(files.get('a.txt').toString('utf8'), 'hello '.repeat(200));
  assert.deepEqual(files.get('b/c.bin'), noise);
});

test('the same files make the same archive', () => {
  const one = writeZip(new Map([['x.json', '{}\n']]));
  const two = writeZip(new Map([['x.json', '{}\n']]));
  assert.deepEqual(one, two);
  assert.equal(one.readUInt16LE(10), 0);        // time
  assert.equal(one.readUInt16LE(12), 0x21);     // 1 January 1980
});

test('something that is not an archive is refused', () => {
  assert.throws(() => readZip(Buffer.from('not a zip at all, clearly not')), /not a ZIP archive/);
});

test('a damaged file is refused', () => {
  const archive = writeZip([['a.txt', 'hello '.repeat(200)]]);
  archive[40] ^= 0xff;   // inside the first file's packed data
  assert.throws(() => readZip(archive), /a\.txt/);
});

test('offsets past the end are called damaged, not a range error', () => {
  const make = () => writeZip([['a.txt', 'hello '.repeat(200)]]);
  const poke = (patch) => { const b = Buffer.from(make()); patch(b, b.readUInt32LE(b.length - 22 + 16)); return b; };
  for (const bad of [
    poke((b) => b.writeUInt32LE(0xfffffff0, b.length - 22 + 16)),   // central directory offset
    poke((b, cd) => b.writeUInt32LE(0xfffffff0, cd + 42)),          // local header offset
    poke((b, cd) => b.writeUInt16LE(60000, cd + 28)),               // name length
  ]) assert.throws(() => readZip(bad), (e) => !(e instanceof RangeError) && /damaged/.test(e.message));
});

test('an entry whose local header leaves its sizes to a data descriptor is read', () => {
  const archive = writeZip([['a.txt', 'hello '.repeat(200)]]);
  archive.writeUInt16LE(archive.readUInt16LE(6) | 0x08, 6);   // flag bit 3
  archive.fill(0, 14, 26);                                     // local crc and sizes
  assert.equal(readZip(archive).get('a.txt').toString('utf8'), 'hello '.repeat(200));
});

test('limits on size and count are kept before anything is unpacked', () => {
  assert.throws(() => readZip(writeZip([['a', Buffer.alloc(5000)]]), { maxBytes: 1000 }), /larger unpacked than allowed/);
  assert.throws(() => readZip(writeZip([['a', 'x'], ['b', 'y']]), { maxEntries: 1 }), /more files than allowed/);
  assert.equal(readZip(writeZip([['a', Buffer.alloc(5000)]]), { maxBytes: 5000 }).get('a').length, 5000);
});
