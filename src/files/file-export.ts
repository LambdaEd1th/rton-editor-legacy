export type ZipFileEntry = {
  path: string;
  bytes: Uint8Array;
};

export function outputBaseName(fileName: string, extension: string) {
  const leafName = fileName.split(/[\\/]/).pop() ?? fileName;
  const base = leafName.replace(/\.[^.]+$/, '') || 'rton';
  return `${base}.${extension}`;
}

export function batchOutputPath(path: string, mode: string) {
  const base = stripKnownRtonExtension(path.replace(/\\/g, '/'));
  if (mode === 'rton') {
    return `${base}.rton`;
  }
  return `${base}.${mode}`;
}

export function uniqueZipPath(path: string, usedPaths: Set<string>) {
  const cleanPath = path.replace(/^\/+/, '').replace(/\/+/g, '/');
  if (!usedPaths.has(cleanPath)) {
    usedPaths.add(cleanPath);
    return cleanPath;
  }

  const slashIndex = cleanPath.lastIndexOf('/');
  const directory = slashIndex === -1 ? '' : `${cleanPath.slice(0, slashIndex + 1)}`;
  const leaf = slashIndex === -1 ? cleanPath : cleanPath.slice(slashIndex + 1);
  const dotIndex = leaf.lastIndexOf('.');
  const stem = dotIndex === -1 ? leaf : leaf.slice(0, dotIndex);
  const extension = dotIndex === -1 ? '' : leaf.slice(dotIndex);
  for (let index = 2; ; index += 1) {
    const candidate = `${directory}${stem}-${index}${extension}`;
    if (!usedPaths.has(candidate)) {
      usedPaths.add(candidate);
      return candidate;
    }
  }
}

export function downloadBlob(data: BlobPart | Blob, name: string, type = 'application/json') {
  const blob = data instanceof Blob ? data : new Blob([data], { type });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = name;
  link.click();
  URL.revokeObjectURL(url);
}

export function downloadBytes(bytes: Uint8Array, name: string) {
  const buffer = new ArrayBuffer(bytes.byteLength);
  new Uint8Array(buffer).set(bytes);
  downloadBlob(new Blob([buffer], { type: 'application/octet-stream' }), name);
}

export function createZipArchive(entries: ZipFileEntry[]) {
  const encoder = new TextEncoder();
  const localParts: Uint8Array[] = [];
  const centralParts: Uint8Array[] = [];
  let offset = 0;

  for (const entry of entries) {
    const nameBytes = encoder.encode(entry.path);
    const crc = crc32(entry.bytes);
    assertZipUint32(entry.bytes.byteLength, 'ZIP entry is too large');
    assertZipUint32(offset, 'ZIP archive is too large');

    const localHeader = new Uint8Array(30 + nameBytes.byteLength);
    const localView = new DataView(localHeader.buffer);
    writeZipU32(localView, 0, 0x04034b50);
    writeZipU16(localView, 4, 20);
    writeZipU16(localView, 6, 0x0800);
    writeZipU16(localView, 8, 0);
    writeZipU16(localView, 10, zipDosTime());
    writeZipU16(localView, 12, zipDosDate());
    writeZipU32(localView, 14, crc);
    writeZipU32(localView, 18, entry.bytes.byteLength);
    writeZipU32(localView, 22, entry.bytes.byteLength);
    writeZipU16(localView, 26, nameBytes.byteLength);
    localHeader.set(nameBytes, 30);
    localParts.push(localHeader, entry.bytes);

    const centralHeader = new Uint8Array(46 + nameBytes.byteLength);
    const centralView = new DataView(centralHeader.buffer);
    writeZipU32(centralView, 0, 0x02014b50);
    writeZipU16(centralView, 4, 20);
    writeZipU16(centralView, 6, 20);
    writeZipU16(centralView, 8, 0x0800);
    writeZipU16(centralView, 10, 0);
    writeZipU16(centralView, 12, zipDosTime());
    writeZipU16(centralView, 14, zipDosDate());
    writeZipU32(centralView, 16, crc);
    writeZipU32(centralView, 20, entry.bytes.byteLength);
    writeZipU32(centralView, 24, entry.bytes.byteLength);
    writeZipU16(centralView, 28, nameBytes.byteLength);
    writeZipU32(centralView, 42, offset);
    centralHeader.set(nameBytes, 46);
    centralParts.push(centralHeader);

    offset += localHeader.byteLength + entry.bytes.byteLength;
  }

  const centralOffset = offset;
  const centralSize = byteLengthOf(centralParts);
  assertZipUint32(centralOffset, 'ZIP archive is too large');
  assertZipUint32(centralSize, 'ZIP central directory is too large');

  const end = new Uint8Array(22);
  const endView = new DataView(end.buffer);
  writeZipU32(endView, 0, 0x06054b50);
  writeZipU16(endView, 8, entries.length);
  writeZipU16(endView, 10, entries.length);
  writeZipU32(endView, 12, centralSize);
  writeZipU32(endView, 16, centralOffset);
  return concatBytes([...localParts, ...centralParts, end]);
}

export function timestampForFileName() {
  const now = new Date();
  const pad = (value: number) => String(value).padStart(2, '0');
  return `${now.getFullYear()}${pad(now.getMonth() + 1)}${pad(now.getDate())}-${pad(now.getHours())}${pad(now.getMinutes())}${pad(now.getSeconds())}`;
}

export function yieldToBrowser() {
  return new Promise<void>((resolve) => window.setTimeout(resolve, 0));
}

export function formatBytes(bytes: number) {
  if (bytes < 1024) {
    return `${bytes} B`;
  }
  if (bytes < 1024 * 1024) {
    return `${(bytes / 1024).toFixed(1)} KB`;
  }
  return `${(bytes / 1024 / 1024).toFixed(2)} MB`;
}

function stripKnownRtonExtension(path: string) {
  return path.replace(/\.(?:rton|dat|json|ya?ml|toml)$/i, '') || 'rton';
}

function byteLengthOf(parts: Uint8Array[]) {
  return parts.reduce((total, part) => total + part.byteLength, 0);
}

function concatBytes(parts: Uint8Array[]) {
  const total = byteLengthOf(parts);
  const out = new Uint8Array(total);
  let offset = 0;
  for (const part of parts) {
    out.set(part, offset);
    offset += part.byteLength;
  }
  return out;
}

function writeZipU16(view: DataView, offset: number, value: number) {
  view.setUint16(offset, value, true);
}

function writeZipU32(view: DataView, offset: number, value: number) {
  view.setUint32(offset, value >>> 0, true);
}

function assertZipUint32(value: number, message: string) {
  if (value > 0xffffffff) {
    throw new Error(message);
  }
}

function zipDosTime(date = new Date()) {
  return (date.getHours() << 11) | (date.getMinutes() << 5) | Math.floor(date.getSeconds() / 2);
}

function zipDosDate(date = new Date()) {
  return ((date.getFullYear() - 1980) << 9) | ((date.getMonth() + 1) << 5) | date.getDate();
}

let crc32Table: Uint32Array | null = null;

function crc32(bytes: Uint8Array) {
  const table = crc32Table ?? (crc32Table = createCrc32Table());
  let crc = 0xffffffff;
  for (const byte of bytes) {
    crc = (crc >>> 8) ^ table[(crc ^ byte) & 0xff];
  }
  return (crc ^ 0xffffffff) >>> 0;
}

function createCrc32Table() {
  const table = new Uint32Array(256);
  for (let index = 0; index < table.length; index += 1) {
    let value = index;
    for (let bit = 0; bit < 8; bit += 1) {
      value = value & 1 ? 0xedb88320 ^ (value >>> 1) : value >>> 1;
    }
    table[index] = value >>> 0;
  }
  return table;
}
