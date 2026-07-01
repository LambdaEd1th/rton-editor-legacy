import type { RtonBinaryEncoding } from './rton-codec';

export type HexByteSource = {
  byteLength: number;
  binaryEncoding: RtonBinaryEncoding;
} & (
  | {
      kind: 'file';
      file: File;
    }
  | {
      kind: 'document';
      documentId: number;
    }
);

export async function readHexByteSourceRange(source: HexByteSource, start: number, end: number) {
  if (source.kind !== 'file') {
    throw new Error('Document-backed hex sources must be read through the RTON worker.');
  }
  const safeStart = Math.max(0, Math.min(source.byteLength, Math.floor(start)));
  const safeEnd = Math.max(safeStart, Math.min(source.byteLength, Math.ceil(end)));
  return new Uint8Array(await source.file.slice(safeStart, safeEnd).arrayBuffer());
}

export async function readHexByteSourceBytes(source: HexByteSource) {
  if (source.kind !== 'file') {
    throw new Error('Document-backed hex sources must be read through the RTON worker.');
  }
  return new Uint8Array(await source.file.arrayBuffer());
}
