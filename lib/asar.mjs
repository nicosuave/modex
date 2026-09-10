import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';

const sha256 = (bytes) => crypto.createHash('sha256').update(bytes).digest('hex');
const blockSize = 4 * 1024 * 1024;

export function integrityForBuffer(bytes, size = blockSize) {
  const blocks = [];
  for (let offset = 0; offset < bytes.length; offset += size) {
    blocks.push(sha256(bytes.subarray(offset, offset + size)));
  }
  if (!bytes.length) blocks.push(sha256(bytes));
  return { algorithm: 'SHA256', hash: sha256(bytes), blockSize: size, blocks };
}

function readExact(fd, length, position) {
  const result = Buffer.alloc(length);
  let read = 0;
  while (read < length) {
    const count = fs.readSync(fd, result, read, length - read, position + read);
    if (!count) throw new Error('Truncated ASAR');
    read += count;
  }
  return result;
}

function writeAll(fd, bytes) {
  let offset = 0;
  while (offset < bytes.length) {
    const count = fs.writeSync(fd, bytes, offset, bytes.length - offset);
    if (!count) throw new Error('Unable to write ASAR data');
    offset += count;
  }
}

export function readArchive(filename) {
  const fd = fs.openSync(filename, 'r');
  try {
    const prefix = readExact(fd, 16, 0);
    const headerSize = prefix.readUInt32LE(4);
    const jsonSize = prefix.readUInt32LE(12);
    if (
      prefix.readUInt32LE(0) !== 4 ||
      headerSize < 8 ||
      jsonSize > headerSize - 8 ||
      headerSize > 64 * 1024 * 1024
    ) {
      throw new Error('Invalid ASAR header');
    }
    const rawHeader = readExact(fd, jsonSize, 16);
    const header = JSON.parse(rawHeader.toString('utf8'));
    if (!header.files || typeof header.files !== 'object') throw new Error('ASAR has no file tree');
    return { filename, header, dataOffset: 8 + headerSize, headerHash: sha256(rawHeader) };
  } finally {
    fs.closeSync(fd);
  }
}

function validRelative(filename) {
  return (
    filename &&
    !filename.includes('\\') &&
    !filename.startsWith('/') &&
    filename
      .split('/')
      .every(
        (part) =>
          part &&
          part !== '.' &&
          part !== '..' &&
          part !== '__proto__' &&
          part !== 'constructor' &&
          part !== 'prototype',
      )
  );
}

export function entryFor(archive, filename) {
  if (!validRelative(filename)) throw new Error(`Invalid archive path: ${filename}`);
  let node = archive.header;
  for (const part of filename.split('/')) node = node?.files?.[part];
  return node;
}

export function readEntry(archive, filename) {
  const entry = entryFor(archive, filename);
  if (!entry || entry.files || entry.link || entry.unpacked)
    throw new Error(`Not a packed file: ${filename}`);
  const fd = fs.openSync(archive.filename, 'r');
  try {
    return readExact(fd, entry.size, archive.dataOffset + Number(entry.offset));
  } finally {
    fs.closeSync(fd);
  }
}

function encodeHeader(header) {
  const json = Buffer.from(JSON.stringify(header));
  const payloadSize = 4 + json.length + ((4 - (json.length % 4)) % 4);
  const buffer = Buffer.alloc(12 + payloadSize);
  buffer.writeUInt32LE(4, 0);
  buffer.writeUInt32LE(4 + payloadSize, 4);
  buffer.writeUInt32LE(payloadSize, 8);
  buffer.writeUInt32LE(json.length, 12);
  json.copy(buffer, 16);
  return buffer;
}

export function readOverlay(directory) {
  const files = new Map();
  function visit(current, relative = '') {
    for (const item of fs
      .readdirSync(current, { withFileTypes: true })
      .sort((a, b) => a.name.localeCompare(b.name))) {
      const name = relative ? `${relative}/${item.name}` : item.name;
      if (!validRelative(name)) throw new Error(`Invalid overlay path: ${name}`);
      const absolute = path.join(current, item.name);
      if (item.isDirectory()) visit(absolute, name);
      else if (item.isFile()) files.set(name, fs.readFileSync(absolute));
      else throw new Error(`Overlay must contain only regular files and directories: ${name}`);
    }
  }
  visit(directory);
  return files;
}

/** Rebuild packed data and offsets, preserving links, unpacked entries and untouched integrity metadata. */
export function rewriteArchive(source, destination, replacements) {
  if (path.resolve(source) === path.resolve(destination))
    throw new Error('Source and destination must differ');
  const archive = readArchive(source);
  const header = structuredClone(archive.header);
  for (const [name, bytes] of replacements) {
    if (!validRelative(name)) throw new Error(`Invalid replacement path: ${name}`);
    if (!Buffer.isBuffer(bytes)) throw new Error(`Replacement is not a Buffer: ${name}`);
    const parts = name.split('/');
    let node = header;
    for (const part of parts.slice(0, -1)) {
      if (node.files[part] && (!node.files[part].files || node.files[part].unpacked))
        throw new Error(`Overlay conflicts with existing file or unpacked directory: ${name}`);
      node.files[part] ??= { files: {} };
      node = node.files[part];
    }
    const leaf = parts.at(-1);
    const old = node.files[leaf];
    if (old?.files || old?.link || old?.unpacked)
      throw new Error(`Cannot replace directory, link or unpacked entry: ${name}`);
    node.files[leaf] = {
      ...old,
      size: bytes.length,
      offset: '0',
      integrity: integrityForBuffer(bytes),
    };
  }

  const files = [];
  let offset = 0;
  function visit(node, prefix = '') {
    for (const [name, entry] of Object.entries(node.files)) {
      const filename = `${prefix}${name}`;
      if (entry.files) visit(entry, `${filename}/`);
      else if (!entry.link && !entry.unpacked) {
        const original = entryFor(archive, filename);
        if (!Number.isSafeInteger(entry.size) || entry.size < 0)
          throw new Error(`Invalid file size: ${filename}`);
        files.push({
          name: filename,
          size: entry.size,
          sourceOffset: original ? archive.dataOffset + Number(original.offset) : null,
        });
        entry.offset = String(offset);
        offset += entry.size;
      }
    }
  }
  visit(header);
  const temporary = `${destination}.tmp-${process.pid}-${crypto.randomBytes(4).toString('hex')}`;
  let input, output;
  try {
    input = fs.openSync(source, 'r');
    output = fs.openSync(temporary, 'wx', 0o644);
    writeAll(output, encodeHeader(header));
    const buffer = Buffer.alloc(8 * 1024 * 1024);
    for (const file of files) {
      const replacement = replacements.get(file.name);
      if (replacement) writeAll(output, replacement);
      else {
        for (let read = 0; read < file.size;) {
          const count = fs.readSync(
            input,
            buffer,
            0,
            Math.min(buffer.length, file.size - read),
            file.sourceOffset + read,
          );
          if (!count) throw new Error(`Truncated file data: ${file.name}`);
          writeAll(output, buffer.subarray(0, count));
          read += count;
        }
      }
    }
    fs.fsyncSync(output);
    fs.closeSync(output);
    output = undefined;
    fs.renameSync(temporary, destination);
    return {
      headerHash: readArchive(destination).headerHash,
      replaced: [...replacements.keys()],
      packedFiles: files.length,
    };
  } finally {
    if (input !== undefined) fs.closeSync(input);
    if (output !== undefined) fs.closeSync(output);
    if (fs.existsSync(temporary)) fs.unlinkSync(temporary);
  }
}
