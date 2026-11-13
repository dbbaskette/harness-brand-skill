// ZIP archives (PowerPoint files are ZIP archives too), with Node's own zlib.
import { deflateRawSync, inflateRawSync } from 'node:zlib';

const TABLE = Array.from({ length: 256 }, (_, n) => {
  let c = n;
  for (let k = 0; k < 8; k += 1) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  return c >>> 0;
});

export function crc32(bytes) {
  let c = 0xffffffff;
  for (let i = 0; i < bytes.length; i += 1) c = TABLE[(c ^ bytes[i]) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

function endRecord(buffer) {
  for (let at = buffer.length - 22; at >= Math.max(0, buffer.length - 65557); at -= 1) {
    if (buffer.readUInt32LE(at) === 0x06054b50) return at;
  }
  throw new Error('It is not a ZIP archive.');
}

function readEntries(buffer, end, { maxBytes, maxEntries }) {
  const count = buffer.readUInt16LE(end + 10);
  if (count > maxEntries) throw new Error(`It holds more files than allowed (${count}, at most ${maxEntries}).`);
  let unpacked = 0;
  let at = buffer.readUInt32LE(end + 16);
  const files = new Map();
  for (let n = 0; n < count; n += 1) {
    if (buffer.readUInt32LE(at) !== 0x02014b50) throw new Error('The ZIP archive is damaged.');
    const method = buffer.readUInt16LE(at + 10);
    const crc = buffer.readUInt32LE(at + 16);
    const packed = buffer.readUInt32LE(at + 20);
    const size = buffer.readUInt32LE(at + 24);
    const nameLength = buffer.readUInt16LE(at + 28);
    const extra = buffer.readUInt16LE(at + 30);
    const comment = buffer.readUInt16LE(at + 32);
    if (at + 46 + nameLength + extra + comment > end) throw new Error('The ZIP archive is damaged.');
    const local = buffer.readUInt32LE(at + 42);
    const name = buffer.toString('utf8', at + 46, at + 46 + nameLength);
    at += 46 + nameLength + extra + comment;
    if (name.endsWith('/')) continue;
    if (packed === 0xffffffff || size === 0xffffffff) throw new Error('ZIP64 archives are not read.');
    unpacked += size;
    if (unpacked > maxBytes) throw new Error('It is larger unpacked than allowed.');
    if (buffer.readUInt32LE(local) !== 0x04034b50) throw new Error('The ZIP archive is damaged.');
    const start = local + 30 + buffer.readUInt16LE(local + 26) + buffer.readUInt16LE(local + 28);
    if (start + packed > buffer.length) throw new Error('The ZIP archive is damaged.');
    const raw = buffer.subarray(start, start + packed);
    let data;
    try {
      if (method === 0) data = Buffer.from(raw);
      else if (method === 8) data = inflateRawSync(raw, { maxOutputLength: Math.max(size, 1) });
      else throw new Error(`it is packed in a way that is not read (method ${method})`);
    } catch (error) {
      throw new Error(`${name} cannot be unpacked: ${error.message}.`);
    }
    if (data.length !== size || crc32(data) !== crc) throw new Error(`${name} does not match its checksum.`);
    files.set(name, data);
  }
  return files;
}

/** Every file in the archive, as a Map of name to Buffer. Folders are left out. `maxBytes`
 *  (unpacked) and `maxEntries` are checked before anything is unpacked. */
export function readZip(buffer, { maxBytes = Infinity, maxEntries = Infinity } = {}) {
  if (buffer.length < 22) throw new Error('It is not a ZIP archive.');
  const end = endRecord(buffer);
  try {
    return readEntries(buffer, end, { maxBytes, maxEntries });
  } catch (error) {
    if (error instanceof RangeError) throw new Error('The ZIP archive is damaged.');
    throw error;
  }
}

// 1 January 1980 for every file, so the same files always make the same archive.
const TIME = 0;
const DATE = (1 << 5) | 1;
const UTF8 = 0x0800;

/** An archive of `files`: a Map or a list of [name, Buffer or text], in that order. */
export function writeZip(files, { store = false } = {}) {
  const list = files instanceof Map ? [...files] : files;
  const parts = [];
  const directory = [];
  let offset = 0;
  for (const [name, content] of list) {
    const data = Buffer.isBuffer(content) ? content : Buffer.from(content, 'utf8');
    const packed = store ? data : deflateRawSync(data);
    const stored = store || packed.length >= data.length;
    const body = stored ? data : packed;
    const method = stored ? 0 : 8;
    const nameBytes = Buffer.from(name, 'utf8');
    const crc = crc32(data);
    const header = Buffer.alloc(30);
    header.writeUInt32LE(0x04034b50, 0);
    header.writeUInt16LE(20, 4);
    header.writeUInt16LE(UTF8, 6);
    header.writeUInt16LE(method, 8);
    header.writeUInt16LE(TIME, 10);
    header.writeUInt16LE(DATE, 12);
    header.writeUInt32LE(crc, 14);
    header.writeUInt32LE(body.length, 18);
    header.writeUInt32LE(data.length, 22);
    header.writeUInt16LE(nameBytes.length, 26);
    const entry = Buffer.alloc(46);
    entry.writeUInt32LE(0x02014b50, 0);
    entry.writeUInt16LE(20, 4);
    entry.writeUInt16LE(20, 6);
    entry.writeUInt16LE(UTF8, 8);
    entry.writeUInt16LE(method, 10);
    entry.writeUInt16LE(TIME, 12);
    entry.writeUInt16LE(DATE, 14);
    entry.writeUInt32LE(crc, 16);
    entry.writeUInt32LE(body.length, 20);
    entry.writeUInt32LE(data.length, 24);
    entry.writeUInt16LE(nameBytes.length, 28);
    entry.writeUInt32LE(offset, 42);
    parts.push(header, nameBytes, body);
    directory.push(entry, nameBytes);
    offset += 30 + nameBytes.length + body.length;
  }
  const central = Buffer.concat(directory);
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0);
  end.writeUInt16LE(list.length, 8);
  end.writeUInt16LE(list.length, 10);
  end.writeUInt32LE(central.length, 12);
  end.writeUInt32LE(offset, 16);
  return Buffer.concat([...parts, central, end]);
}
