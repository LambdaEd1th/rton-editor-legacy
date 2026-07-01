export type RtonByteInspection = {
  offset: number;
  byte: number;
  byteHex: string;
  ascii: string;
  special: RtonSpecialRegion | null;
  tag: RtonTagInfo | null;
  payload: RtonPayloadInfo | null;
  varint: RtonVarintInfo | null;
  stringInfo: RtonStringInfo | null;
  asciiRun: RtonAsciiRun | null;
  tableScan: RtonStringTableScanInfo | null;
};

export type RtonSpecialRegion = {
  kind: 'header' | 'footer' | 'version';
  label: string;
};

export type RtonTagInfo = {
  byte: number;
  hex: string;
  name: string;
  category: string;
  payloadKind: string;
};

export type RtonPayloadInfo = {
  label: string;
  value: string;
  bytes?: string;
  range?: string;
};

export type RtonVarintInfo = {
  value: string;
  zigzag: string;
  length: number;
  bytes: string;
  nextOffset: number;
};

export type RtonStringInfo = {
  mode: 'direct' | 'definition' | 'reference';
  encoding: 'ASCII' | 'UTF-8';
  table: 'ASCII' | 'UTF-8' | null;
  index: string | null;
  length: string | null;
  byteLength: string | null;
  text: string | null;
  resolvedText: string | null;
  scanLimited: boolean;
  scanError: string | null;
};

export type RtonAsciiRun = {
  text: string;
  start: number;
  end: number;
};

export type RtonStringTableScanInfo = {
  asciiCount: number | null;
  utf8Count: number | null;
  limited: boolean;
  error: string | null;
};

type RtonTagDefinition = {
  name: string;
  category: string;
  payloadKind: string;
};

type StringTables = {
  ascii: string[];
  utf8: string[];
  limited: boolean;
  error: string | null;
};

type ParsedStringPayload = {
  text: string;
  length: bigint | null;
  byteLength: bigint;
  endOffset: number;
};

const STRING_TABLE_SCAN_LIMIT = 768 * 1024;
const ASCII_RUN_LIMIT = 96;
const FILE_HEADER = [0x52, 0x54, 0x4f, 0x4e];
const FILE_FOOTER = [0x44, 0x4f, 0x4e, 0x45];

const RTON_TAGS = new Map<number, RtonTagDefinition>([
  [0x00, { name: 'BoolFalse', category: 'bool', payloadKind: 'none' }],
  [0x01, { name: 'BoolTrue', category: 'bool', payloadKind: 'none' }],
  [0x02, { name: 'StrNull (*)', category: 'string', payloadKind: 'literal *' }],
  [0x08, { name: 'Int8', category: 'number', payloadKind: 'i8' }],
  [0x09, { name: 'Int8Zero', category: 'number', payloadKind: 'zero' }],
  [0x0a, { name: 'UInt8', category: 'number', payloadKind: 'u8' }],
  [0x0b, { name: 'UIntZero', category: 'number', payloadKind: 'zero' }],
  [0x10, { name: 'Int16', category: 'number', payloadKind: 'i16le' }],
  [0x11, { name: 'Int16Zero', category: 'number', payloadKind: 'zero' }],
  [0x12, { name: 'UInt16', category: 'number', payloadKind: 'u16le' }],
  [0x13, { name: 'UInt16Zero', category: 'number', payloadKind: 'zero' }],
  [0x20, { name: 'Int32', category: 'number', payloadKind: 'i32le' }],
  [0x21, { name: 'Int32Zero', category: 'number', payloadKind: 'zero' }],
  [0x22, { name: 'Float', category: 'number', payloadKind: 'f32le' }],
  [0x23, { name: 'FloatZero', category: 'number', payloadKind: 'zero' }],
  [0x24, { name: 'VarIntU32', category: 'varint', payloadKind: 'varint u32' }],
  [0x25, { name: 'VarIntI32', category: 'varint', payloadKind: 'zigzag i32' }],
  [0x26, { name: 'UInt32', category: 'number', payloadKind: 'u32le' }],
  [0x27, { name: 'UInt32Zero', category: 'number', payloadKind: 'zero' }],
  [0x28, { name: 'VarIntU32Alt', category: 'varint', payloadKind: 'varint u32' }],
  [0x29, { name: 'VarIntI32Alt', category: 'varint', payloadKind: 'zigzag i32' }],
  [0x40, { name: 'Int64', category: 'number', payloadKind: 'i64le' }],
  [0x41, { name: 'Int64Zero', category: 'number', payloadKind: 'zero' }],
  [0x42, { name: 'Double', category: 'number', payloadKind: 'f64le' }],
  [0x43, { name: 'DoubleZero', category: 'number', payloadKind: 'zero' }],
  [0x44, { name: 'VarIntU64', category: 'varint', payloadKind: 'varint u64' }],
  [0x45, { name: 'VarIntI64', category: 'varint', payloadKind: 'zigzag i64' }],
  [0x46, { name: 'UInt64', category: 'number', payloadKind: 'u64le' }],
  [0x47, { name: 'UInt64Zero', category: 'number', payloadKind: 'zero' }],
  [0x48, { name: 'VarIntU64Alt', category: 'varint', payloadKind: 'varint u64' }],
  [0x49, { name: 'VarIntI64Alt', category: 'varint', payloadKind: 'zigzag i64' }],
  [0x81, { name: 'StrAsciiDirect', category: 'string', payloadKind: 'ascii direct' }],
  [0x82, { name: 'StrUtf8Direct', category: 'string', payloadKind: 'utf8 direct' }],
  [0x83, { name: 'Rtid', category: 'rtid', payloadKind: 'rtid payload' }],
  [0x84, { name: 'RtidZero', category: 'rtid', payloadKind: 'none' }],
  [0x85, { name: 'ObjectStart', category: 'container', payloadKind: 'object entries' }],
  [0x86, { name: 'ArrayStart', category: 'container', payloadKind: 'array capacity' }],
  [0x87, { name: 'BinaryBlob', category: 'binary', payloadKind: 'binary blob' }],
  [0x90, { name: 'StrAsciiDef', category: 'string table', payloadKind: 'ascii definition' }],
  [0x91, { name: 'StrAsciiRef', category: 'string table', payloadKind: 'ascii reference' }],
  [0x92, { name: 'StrUtf8Def', category: 'string table', payloadKind: 'utf8 definition' }],
  [0x93, { name: 'StrUtf8Ref', category: 'string table', payloadKind: 'utf8 reference' }],
  [0xb0, { name: 'StrCompactAsciiDef', category: 'compact string table', payloadKind: 'ascii definition' }],
  [0xb1, { name: 'StrCompactAsciiRef', category: 'compact string table', payloadKind: 'ascii reference' }],
  [0xb2, { name: 'StrCompactUtf8Def', category: 'compact string table', payloadKind: 'utf8 definition' }],
  [0xb3, { name: 'StrCompactUtf8Ref', category: 'compact string table', payloadKind: 'utf8 reference' }],
  [0xb4, { name: 'StrCompactPair1', category: 'compact string table', payloadKind: 'ascii definition' }],
  [0xb5, { name: 'StrCompactPair2', category: 'compact string table', payloadKind: 'ascii reference' }],
  [0xb6, { name: 'StrCompactPair3', category: 'compact string table', payloadKind: 'utf8 definition' }],
  [0xb7, { name: 'StrCompactPair4', category: 'compact string table', payloadKind: 'utf8 reference' }],
  [0xb8, { name: 'ObjectStartCompact', category: 'container', payloadKind: 'object entries' }],
  [0xb9, { name: 'ArrayStartCompact', category: 'container', payloadKind: 'array capacity' }],
  [0xba, { name: 'RtidCompact', category: 'rtid', payloadKind: 'rtid payload' }],
  [0xbb, { name: 'BinaryBlobCompact', category: 'binary', payloadKind: 'binary blob' }],
  [0xbc, { name: 'BoolCompact', category: 'bool', payloadKind: 'u8 bool' }],
  [0xfd, { name: 'ArrayCapacity', category: 'container', payloadKind: 'varint capacity' }],
  [0xfe, { name: 'ArrayEnd', category: 'container', payloadKind: 'none' }],
  [0xff, { name: 'ObjectEnd', category: 'container', payloadKind: 'none' }],
]);

export function inspectRtonByte(
  bytes: Uint8Array,
  offset: number,
  options: { scanStringTables?: boolean } = {},
): RtonByteInspection | null {
  if (bytes.length === 0 || offset < 0 || offset >= bytes.length) {
    return null;
  }

  const byte = bytes[offset];
  const tagDefinition = RTON_TAGS.get(byte);
  const tag = tagDefinition
    ? { byte, hex: byteToHex(byte), ...tagDefinition }
    : null;
  const tables = options.scanStringTables === false ? null : maybeCollectStringTables(bytes, offset);
  const stringInfo = inspectStringInfo(bytes, offset, tables);

  return {
    offset,
    byte,
    byteHex: byteToHex(byte),
    ascii: printableAscii(byte),
    special: inspectSpecialRegion(bytes, offset),
    tag,
    payload: inspectPayload(bytes, offset, tag),
    varint: readVarint(bytes, offset),
    stringInfo,
    asciiRun: inspectAsciiRun(bytes, offset),
    tableScan: tables
      ? {
          asciiCount: tables.limited ? null : tables.ascii.length,
          utf8Count: tables.limited ? null : tables.utf8.length,
          limited: tables.limited,
          error: tables.error,
        }
      : null,
  };
}

function inspectSpecialRegion(bytes: Uint8Array, offset: number): RtonSpecialRegion | null {
  if (FILE_HEADER.every((byte, index) => bytes[index] === byte) && offset >= 0 && offset < 4) {
    return { kind: 'header', label: 'RTON header magic' };
  }
  if (FILE_HEADER.every((byte, index) => bytes[index] === byte) && offset >= 4 && offset < 8) {
    return { kind: 'version', label: `RTON version ${readU32(bytes, 4) ?? '?'}` };
  }
  if (FILE_FOOTER.every((byte, index) => bytes[bytes.length - 4 + index] === byte) && offset >= bytes.length - 4) {
    return { kind: 'footer', label: 'RTON footer DONE' };
  }
  return null;
}

function inspectPayload(bytes: Uint8Array, offset: number, tag: RtonTagInfo | null): RtonPayloadInfo | null {
  if (!tag) {
    return null;
  }

  const payloadOffset = offset + 1;
  try {
    switch (tag.byte) {
      case 0x00:
        return scalarPayload('bool', 'false');
      case 0x01:
        return scalarPayload('bool', 'true');
      case 0x02:
        return scalarPayload('literal', '*');
      case 0x09:
      case 0x0b:
      case 0x11:
      case 0x13:
      case 0x21:
      case 0x23:
      case 0x27:
      case 0x41:
      case 0x43:
      case 0x47:
        return scalarPayload('value', '0');
      case 0x08:
        return fixedPayload(bytes, payloadOffset, 1, 'i8', String(readI8(bytes, payloadOffset)));
      case 0x0a:
      case 0xbc:
        return fixedPayload(bytes, payloadOffset, 1, tag.byte === 0xbc ? 'bool byte' : 'u8', String(bytes[payloadOffset] ?? '?'));
      case 0x10:
        return fixedPayload(bytes, payloadOffset, 2, 'i16le', String(readI16(bytes, payloadOffset) ?? '?'));
      case 0x12:
        return fixedPayload(bytes, payloadOffset, 2, 'u16le', String(readU16(bytes, payloadOffset) ?? '?'));
      case 0x20:
        return fixedPayload(bytes, payloadOffset, 4, 'i32le', String(readI32(bytes, payloadOffset) ?? '?'));
      case 0x22:
        return fixedPayload(bytes, payloadOffset, 4, 'f32le', String(readF32(bytes, payloadOffset) ?? '?'));
      case 0x26:
        return fixedPayload(bytes, payloadOffset, 4, 'u32le', String(readU32(bytes, payloadOffset) ?? '?'));
      case 0x40:
        return fixedPayload(bytes, payloadOffset, 8, 'i64le', readI64(bytes, payloadOffset) ?? '?');
      case 0x42:
        return fixedPayload(bytes, payloadOffset, 8, 'f64le', String(readF64(bytes, payloadOffset) ?? '?'));
      case 0x46:
        return fixedPayload(bytes, payloadOffset, 8, 'u64le', readU64(bytes, payloadOffset) ?? '?');
      case 0x24:
      case 0x25:
      case 0x28:
      case 0x29:
      case 0x44:
      case 0x45:
      case 0x48:
      case 0x49:
      case 0xfd:
        return varintPayload(bytes, payloadOffset, tag.byte === 0x25 || tag.byte === 0x29 || tag.byte === 0x45 || tag.byte === 0x49);
      case 0x81:
      case 0x90:
      case 0xb0:
      case 0xb4:
        return stringPayload(bytes, payloadOffset, false);
      case 0x82:
      case 0x92:
      case 0xb2:
      case 0xb6:
        return stringPayload(bytes, payloadOffset, true);
      case 0x91:
      case 0x93:
      case 0xb1:
      case 0xb3:
      case 0xb5:
      case 0xb7:
        return varintPayload(bytes, payloadOffset, false, 'table index');
      case 0x86:
      case 0xb9:
        return inspectArrayCapacityPayload(bytes, payloadOffset);
      case 0x83:
      case 0xba:
        return inspectRtidPayload(bytes, payloadOffset);
      case 0x84:
        return scalarPayload('rtid', 'RTID(0)');
      case 0xbb: {
        const len = readVarint(bytes, payloadOffset);
        return len ? { label: 'binary length', value: len.value, bytes: len.bytes, range: offsetRange(payloadOffset, len.nextOffset) } : null;
      }
      default:
        return null;
    }
  } catch {
    return null;
  }
}

function inspectStringInfo(bytes: Uint8Array, offset: number, tables: StringTables | null): RtonStringInfo | null {
  const tag = bytes[offset];
  const payloadOffset = offset + 1;
  const asciiDefinition = tag === 0x90 || tag === 0xb0 || tag === 0xb4;
  const utf8Definition = tag === 0x92 || tag === 0xb2 || tag === 0xb6;
  const asciiReference = tag === 0x91 || tag === 0xb1 || tag === 0xb5;
  const utf8Reference = tag === 0x93 || tag === 0xb3 || tag === 0xb7;
  const asciiDirect = tag === 0x81;
  const utf8Direct = tag === 0x82;

  try {
    if (asciiDirect || asciiDefinition || utf8Direct || utf8Definition) {
      const parsed = readStringPayload(bytes, payloadOffset, utf8Direct || utf8Definition);
      const table = asciiDefinition ? 'ASCII' : utf8Definition ? 'UTF-8' : null;
      const tableValues = table === 'ASCII' ? tables?.ascii : table === 'UTF-8' ? tables?.utf8 : null;
      return {
        mode: asciiDirect || utf8Direct ? 'direct' : 'definition',
        encoding: utf8Direct || utf8Definition ? 'UTF-8' : 'ASCII',
        table,
        index: tableValues && !tables?.limited ? String(tableValues.length) : null,
        length: parsed.length?.toString() ?? null,
        byteLength: parsed.byteLength.toString(),
        text: trimPreview(parsed.text),
        resolvedText: null,
        scanLimited: Boolean(tables?.limited),
        scanError: tables?.error ?? null,
      };
    }

    if (asciiReference || utf8Reference) {
      const table = asciiReference ? 'ASCII' : 'UTF-8';
      const index = readVarint(bytes, payloadOffset);
      const values = table === 'ASCII' ? tables?.ascii : tables?.utf8;
      const numericIndex = index ? safeNumber(BigInt(index.value)) : null;
      const resolvedText =
        values && numericIndex !== null && numericIndex >= 0 && numericIndex < values.length
          ? trimPreview(values[numericIndex])
          : null;
      return {
        mode: 'reference',
        encoding: table,
        table,
        index: index?.value ?? null,
        length: null,
        byteLength: null,
        text: null,
        resolvedText,
        scanLimited: Boolean(tables?.limited),
        scanError: tables?.error ?? null,
      };
    }
  } catch (error) {
    return {
      mode: asciiReference || utf8Reference ? 'reference' : asciiDirect || utf8Direct ? 'direct' : 'definition',
      encoding: utf8Reference || utf8Definition || utf8Direct ? 'UTF-8' : 'ASCII',
      table: asciiDirect || utf8Direct ? null : utf8Reference || utf8Definition ? 'UTF-8' : 'ASCII',
      index: null,
      length: null,
      byteLength: null,
      text: null,
      resolvedText: null,
      scanLimited: Boolean(tables?.limited),
      scanError: error instanceof Error ? error.message : String(error),
    };
  }

  return null;
}

function maybeCollectStringTables(bytes: Uint8Array, targetOffset: number): StringTables | null {
  if (targetOffset <= 0) {
    return { ascii: [], utf8: [], limited: false, error: null };
  }
  if (targetOffset > STRING_TABLE_SCAN_LIMIT) {
    return { ascii: [], utf8: [], limited: true, error: null };
  }

  const scanner = new RtonStringTableScanner(bytes, targetOffset);
  return scanner.scan();
}

class RtonStringTableScanner {
  private readonly ascii: string[] = [];
  private readonly utf8: string[] = [];

  constructor(
    private readonly bytes: Uint8Array,
    private readonly targetOffset: number,
  ) {}

  scan(): StringTables {
    try {
      let cursor = hasRtonHeader(this.bytes) ? 8 : 0;
      while (cursor < this.targetOffset && cursor < this.bytes.length && !isFooterAt(this.bytes, cursor)) {
        const next = this.scanValue(cursor);
        if (next <= cursor) {
          throw new Error('RTON scanner did not advance');
        }
        cursor = next;
      }
      return { ascii: this.ascii, utf8: this.utf8, limited: false, error: null };
    } catch (error) {
      return {
        ascii: this.ascii,
        utf8: this.utf8,
        limited: false,
        error: error instanceof Error ? error.message : String(error),
      };
    }
  }

  private scanValue(offset: number): number {
    if (offset >= this.targetOffset) {
      return offset;
    }

    const tag = this.byteAt(offset);
    let cursor = offset + 1;
    switch (tag) {
      case 0x00:
      case 0x01:
      case 0x02:
      case 0x09:
      case 0x0b:
      case 0x11:
      case 0x13:
      case 0x21:
      case 0x23:
      case 0x27:
      case 0x41:
      case 0x43:
      case 0x47:
      case 0x84:
      case 0xfe:
      case 0xff:
        return cursor;
      case 0x08:
      case 0x0a:
      case 0xbc:
        return cursor + 1;
      case 0x10:
      case 0x12:
        return cursor + 2;
      case 0x20:
      case 0x22:
      case 0x26:
        return cursor + 4;
      case 0x40:
      case 0x42:
      case 0x46:
        return cursor + 8;
      case 0x24:
      case 0x25:
      case 0x28:
      case 0x29:
      case 0x44:
      case 0x45:
      case 0x48:
      case 0x49:
      case 0x91:
      case 0x93:
      case 0xb1:
      case 0xb3:
      case 0xb5:
      case 0xb7:
      case 0xfd:
        return this.readVarint(cursor).nextOffset;
      case 0x81:
        return this.skipString(cursor, false, null);
      case 0x82:
        return this.skipString(cursor, true, null);
      case 0x90:
      case 0xb0:
      case 0xb4:
        return this.skipString(cursor, false, this.ascii);
      case 0x92:
      case 0xb2:
      case 0xb6:
        return this.skipString(cursor, true, this.utf8);
      case 0x83:
      case 0xba:
        return this.skipRtid(cursor);
      case 0x85:
      case 0xb8:
        return this.scanObject(cursor);
      case 0x86:
      case 0xb9:
        return this.scanArray(cursor);
      case 0x87:
        cursor += 1;
        cursor = this.skipString(cursor, false, null);
        return this.readVarint(cursor).nextOffset;
      case 0xbb: {
        const length = this.readVarint(cursor);
        return length.nextOffset + this.safeLength(length.value);
      }
      default:
        throw new Error(`Unknown RTON tag 0x${byteToHex(tag)} at offset 0x${offset.toString(16).toUpperCase()}`);
    }
  }

  private scanObject(offset: number): number {
    let cursor = offset;
    while (cursor < this.bytes.length && cursor < this.targetOffset) {
      if (this.byteAt(cursor) === 0xff || isFooterAt(this.bytes, cursor)) {
        return cursor + 1;
      }
      cursor = this.scanValue(cursor);
      if (cursor >= this.targetOffset) {
        return cursor;
      }
      cursor = this.scanValue(cursor);
    }
    return cursor;
  }

  private scanArray(offset: number): number {
    let cursor = offset;
    if (this.byteAt(cursor) !== 0xfd) {
      throw new Error('Missing RTON array capacity tag');
    }
    const capacity = this.readVarint(cursor + 1);
    cursor = capacity.nextOffset;
    const count = Math.min(this.safeLength(capacity.value), 1_000_000);
    for (let index = 0; index < count && cursor < this.bytes.length && cursor < this.targetOffset; index += 1) {
      if (this.byteAt(cursor) === 0xfe) {
        return cursor + 1;
      }
      cursor = this.scanValue(cursor);
    }
    return this.byteAt(cursor) === 0xfe ? cursor + 1 : cursor;
  }

  private skipRtid(offset: number): number {
    const subTag = this.byteAt(offset);
    let cursor = offset + 1;
    if (subTag === 0x00) {
      return cursor;
    }
    if (subTag === 0x01) {
      cursor = this.readVarint(cursor).nextOffset;
      cursor = this.readVarint(cursor).nextOffset;
      return cursor + 4;
    }
    if (subTag === 0x02) {
      cursor = this.skipString(cursor, true, null);
      cursor = this.readVarint(cursor).nextOffset;
      cursor = this.readVarint(cursor).nextOffset;
      return cursor + 4;
    }
    if (subTag === 0x03) {
      cursor = this.skipString(cursor, true, null);
      return this.skipString(cursor, true, null);
    }
    throw new Error(`Unknown RTID subtag 0x${byteToHex(subTag)}`);
  }

  private skipString(offset: number, utf8: boolean, table: string[] | null): number {
    const parsed = readStringPayload(this.bytes, offset, utf8);
    if (table && parsed.endOffset <= this.targetOffset) {
      table.push(parsed.text);
    }
    return parsed.endOffset;
  }

  private readVarint(offset: number) {
    const value = readVarint(this.bytes, offset);
    if (!value) {
      throw new Error('Unexpected end of RTON varint');
    }
    return value;
  }

  private safeLength(value: string) {
    const number = safeNumber(BigInt(value));
    if (number === null) {
      throw new Error('RTON length is too large');
    }
    return number;
  }

  private byteAt(offset: number) {
    if (offset < 0 || offset >= this.bytes.length) {
      throw new Error('Unexpected end of RTON bytes');
    }
    return this.bytes[offset];
  }
}

function inspectArrayCapacityPayload(bytes: Uint8Array, offset: number): RtonPayloadInfo | null {
  if (bytes[offset] !== 0xfd) {
    return null;
  }
  const capacity = readVarint(bytes, offset + 1);
  if (!capacity) {
    return null;
  }
  return {
    label: 'capacity',
    value: capacity.value,
    bytes: `${byteToHex(0xfd)} ${capacity.bytes}`,
    range: offsetRange(offset, capacity.nextOffset),
  };
}

function inspectRtidPayload(bytes: Uint8Array, offset: number): RtonPayloadInfo | null {
  const subTag = bytes[offset];
  if (subTag === undefined) {
    return null;
  }
  const name = subTag === 0x00 ? 'Zero' : subTag === 0x01 ? 'UidNoString' : subTag === 0x02 ? 'Uid' : subTag === 0x03 ? 'String' : 'Unknown';
  return {
    label: 'rtid subtag',
    value: `${name} (0x${byteToHex(subTag)})`,
    bytes: byteToHex(subTag),
    range: offsetRange(offset, offset + 1),
  };
}

function stringPayload(bytes: Uint8Array, offset: number, utf8: boolean): RtonPayloadInfo | null {
  const parsed = readStringPayload(bytes, offset, utf8);
  return {
    label: utf8 ? 'utf8 string' : 'ascii string',
    value: trimPreview(parsed.text),
    range: offsetRange(offset, parsed.endOffset),
  };
}

function varintPayload(bytes: Uint8Array, offset: number, signed: boolean, label = 'varint'): RtonPayloadInfo | null {
  const value = readVarint(bytes, offset);
  if (!value) {
    return null;
  }
  return {
    label,
    value: signed ? value.zigzag : value.value,
    bytes: value.bytes,
    range: offsetRange(offset, value.nextOffset),
  };
}

function scalarPayload(label: string, value: string): RtonPayloadInfo {
  return { label, value };
}

function fixedPayload(bytes: Uint8Array, offset: number, length: number, label: string, value: string): RtonPayloadInfo | null {
  if (offset + length > bytes.length) {
    return null;
  }
  return {
    label,
    value,
    bytes: bytesToHex(bytes, offset, offset + length),
    range: offsetRange(offset, offset + length),
  };
}

function readStringPayload(bytes: Uint8Array, offset: number, utf8: boolean): ParsedStringPayload {
  if (!utf8) {
    const length = readVarint(bytes, offset);
    if (!length) {
      throw new Error('Unexpected end of string length');
    }
    const byteLength = BigInt(length.value);
    const byteCount = safeNumber(byteLength);
    if (byteCount === null) {
      throw new Error('String length is too large');
    }
    const textStart = length.nextOffset;
    const textEnd = textStart + byteCount;
    assertRange(bytes, textStart, byteCount);
    return {
      text: decodeLatin1(bytes.subarray(textStart, textEnd)),
      length: byteLength,
      byteLength,
      endOffset: textEnd,
    };
  }

  const charCount = readVarint(bytes, offset);
  if (!charCount) {
    throw new Error('Unexpected end of UTF-8 char count');
  }
  const byteLength = readVarint(bytes, charCount.nextOffset);
  if (!byteLength) {
    throw new Error('Unexpected end of UTF-8 byte length');
  }
  const byteCount = safeNumber(BigInt(byteLength.value));
  if (byteCount === null) {
    throw new Error('String byte length is too large');
  }
  const textStart = byteLength.nextOffset;
  const textEnd = textStart + byteCount;
  assertRange(bytes, textStart, byteCount);
  return {
    text: decodeUtf8(bytes.subarray(textStart, textEnd)),
    length: BigInt(charCount.value),
    byteLength: BigInt(byteLength.value),
    endOffset: textEnd,
  };
}

function readVarint(bytes: Uint8Array, offset: number): RtonVarintInfo | null {
  if (offset < 0 || offset >= bytes.length) {
    return null;
  }

  let value = 0n;
  let shift = 0n;
  let cursor = offset;
  while (cursor < bytes.length && cursor - offset < 10) {
    const byte = BigInt(bytes[cursor]);
    value |= (byte & 0x7fn) << shift;
    cursor += 1;
    if ((byte & 0x80n) === 0n) {
      return {
        value: value.toString(),
        zigzag: decodeZigZag(value).toString(),
        length: cursor - offset,
        bytes: bytesToHex(bytes, offset, cursor),
        nextOffset: cursor,
      };
    }
    shift += 7n;
  }

  return null;
}

function decodeZigZag(value: bigint) {
  return (value >> 1n) ^ -(value & 1n);
}

function inspectAsciiRun(bytes: Uint8Array, offset: number): RtonAsciiRun | null {
  if (!isPrintableAscii(bytes[offset])) {
    return null;
  }

  let start = offset;
  let end = offset + 1;
  while (start > 0 && offset - start < ASCII_RUN_LIMIT / 2 && isPrintableAscii(bytes[start - 1])) {
    start -= 1;
  }
  while (end < bytes.length && end - offset < ASCII_RUN_LIMIT / 2 && isPrintableAscii(bytes[end])) {
    end += 1;
  }

  return {
    text: decodeLatin1(bytes.subarray(start, end)),
    start,
    end,
  };
}

function readI8(bytes: Uint8Array, offset: number) {
  const value = bytes[offset];
  if (value === undefined) {
    return '?';
  }
  return value << 24 >> 24;
}

function readU16(bytes: Uint8Array, offset: number) {
  if (offset + 2 > bytes.length) {
    return null;
  }
  return bytes[offset] | (bytes[offset + 1] << 8);
}

function readI16(bytes: Uint8Array, offset: number) {
  const value = readU16(bytes, offset);
  return value === null ? null : value << 16 >> 16;
}

function readU32(bytes: Uint8Array, offset: number) {
  if (offset + 4 > bytes.length) {
    return null;
  }
  return (bytes[offset] | (bytes[offset + 1] << 8) | (bytes[offset + 2] << 16) | (bytes[offset + 3] << 24)) >>> 0;
}

function readI32(bytes: Uint8Array, offset: number) {
  const value = readU32(bytes, offset);
  return value === null ? null : value | 0;
}

function readU64(bytes: Uint8Array, offset: number) {
  if (offset + 8 > bytes.length) {
    return null;
  }
  let value = 0n;
  for (let index = 0; index < 8; index += 1) {
    value |= BigInt(bytes[offset + index]) << BigInt(index * 8);
  }
  return value.toString();
}

function readI64(bytes: Uint8Array, offset: number) {
  const unsigned = readU64(bytes, offset);
  if (unsigned === null) {
    return null;
  }
  const value = BigInt(unsigned);
  return (value & (1n << 63n) ? value - (1n << 64n) : value).toString();
}

function readF32(bytes: Uint8Array, offset: number) {
  if (offset + 4 > bytes.length) {
    return null;
  }
  return new DataView(bytes.buffer, bytes.byteOffset + offset, 4).getFloat32(0, true);
}

function readF64(bytes: Uint8Array, offset: number) {
  if (offset + 8 > bytes.length) {
    return null;
  }
  return new DataView(bytes.buffer, bytes.byteOffset + offset, 8).getFloat64(0, true);
}

function hasRtonHeader(bytes: Uint8Array) {
  return bytes.length >= 8 && FILE_HEADER.every((byte, index) => bytes[index] === byte);
}

function isFooterAt(bytes: Uint8Array, offset: number) {
  return FILE_FOOTER.every((byte, index) => bytes[offset + index] === byte);
}

function assertRange(bytes: Uint8Array, offset: number, length: number) {
  if (offset < 0 || offset + length > bytes.length) {
    throw new Error('Unexpected end of RTON bytes');
  }
}

function safeNumber(value: bigint) {
  return value > BigInt(Number.MAX_SAFE_INTEGER) ? null : Number(value);
}

function offsetRange(start: number, end: number) {
  return `0x${start.toString(16).toUpperCase()}..0x${end.toString(16).toUpperCase()}`;
}

function byteToHex(byte: number) {
  return byte.toString(16).toUpperCase().padStart(2, '0');
}

function bytesToHex(bytes: Uint8Array, start: number, end: number) {
  return Array.from(bytes.subarray(start, end), byteToHex).join(' ');
}

function printableAscii(byte: number) {
  return isPrintableAscii(byte) ? String.fromCharCode(byte) : '.';
}

function isPrintableAscii(byte: number) {
  return byte >= 0x20 && byte <= 0x7e;
}

function decodeLatin1(bytes: Uint8Array) {
  return Array.from(bytes, (byte) => String.fromCharCode(byte)).join('');
}

function decodeUtf8(bytes: Uint8Array) {
  return new TextDecoder('utf-8', { fatal: false }).decode(bytes);
}

function trimPreview(text: string) {
  return text.length > 96 ? `${text.slice(0, 96)}...` : text;
}
