export type RtonOffsetPathSegment = { kind: 'array'; index: number } | { kind: 'object'; index: number };

const FILE_HEADER = [0x52, 0x54, 0x4f, 0x4e];
const FILE_FOOTER = [0x44, 0x4f, 0x4e, 0x45];

const TAG_BOOLEAN_FALSE = 0x00;
const TAG_BOOLEAN_TRUE = 0x01;
const TAG_STRING_ASTERISK = 0x02;
const TAG_I8 = 0x08;
const TAG_I8_ZERO = 0x09;
const TAG_U8 = 0x0a;
const TAG_U8_ZERO = 0x0b;
const TAG_I16 = 0x10;
const TAG_I16_ZERO = 0x11;
const TAG_U16 = 0x12;
const TAG_U16_ZERO = 0x13;
const TAG_I32 = 0x20;
const TAG_I32_ZERO = 0x21;
const TAG_F32 = 0x22;
const TAG_F32_ZERO = 0x23;
const TAG_RAW_VARINT_32 = 0x24;
const TAG_ZIGZAG_VARINT_32 = 0x25;
const TAG_U32 = 0x26;
const TAG_U32_ZERO = 0x27;
const TAG_UNSIGNED_VARINT_32 = 0x28;
const TAG_I64 = 0x40;
const TAG_I64_ZERO = 0x41;
const TAG_F64 = 0x42;
const TAG_F64_ZERO = 0x43;
const TAG_RAW_VARINT_64 = 0x44;
const TAG_ZIGZAG_VARINT_64 = 0x45;
const TAG_U64 = 0x46;
const TAG_U64_ZERO = 0x47;
const TAG_UNSIGNED_VARINT_64 = 0x48;
const TAG_STRING_LATIN1_DIRECT = 0x81;
const TAG_STRING_UTF8_DIRECT = 0x82;
const TAG_RTID = 0x83;
const TAG_RTID_NULL = 0x84;
const TAG_OBJECT_BEGIN = 0x85;
const TAG_ARRAY_BEGIN = 0x86;
const TAG_BINARY_BLOB = 0x87;
const TAG_STRING_LATIN1_DEFINITION = 0x90;
const TAG_STRING_LATIN1_REFERENCE = 0x91;
const TAG_STRING_UTF8_DEFINITION = 0x92;
const TAG_STRING_UTF8_REFERENCE = 0x93;
const TAG_COMPACT_LATIN1_DEFINITION = 0xb0;
const TAG_COMPACT_LATIN1_REFERENCE = 0xb1;
const TAG_COMPACT_UTF32_DEFINITION = 0xb2;
const TAG_COMPACT_UTF32_REFERENCE = 0xb3;
const TAG_COMPACT_LATIN1_DEFINITION_WITH_VALUE_OFFSET = 0xb4;
const TAG_COMPACT_LATIN1_REFERENCE_WITH_VALUE_OFFSET = 0xb5;
const TAG_COMPACT_UTF32_DEFINITION_WITH_VALUE_OFFSET = 0xb6;
const TAG_COMPACT_UTF32_REFERENCE_WITH_VALUE_OFFSET = 0xb7;
const TAG_COMPACT_OBJECT_BEGIN = 0xb8;
const TAG_COMPACT_ARRAY_BEGIN = 0xb9;
const TAG_COMPACT_RTID = 0xba;
const TAG_COMPACT_BINARY_BLOB = 0xbb;
const TAG_COMPACT_BOOLEAN = 0xbc;
const TAG_ARRAY_CAPACITY = 0xfd;
const TAG_ARRAY_END = 0xfe;
const TAG_OBJECT_END = 0xff;

export function locateRtonValueOffset(bytes: Uint8Array, path: RtonOffsetPathSegment[]) {
  try {
    return new RtonOffsetReader(bytes).locate(path);
  } catch {
    return null;
  }
}

class RtonOffsetReader {
  constructor(private readonly bytes: Uint8Array) {}

  locate(path: RtonOffsetPathSegment[]) {
    if (!this.hasHeader()) {
      return null;
    }

    const rootOffset = 8;
    const rootTag = this.byteAt(rootOffset);
    if (path.length === 0) {
      return rootOffset;
    }

    if (rootTag === TAG_OBJECT_BEGIN || rootTag === TAG_COMPACT_OBJECT_BEGIN) {
      return this.locateInObject(rootOffset + 1, path);
    }

    return this.locateInObject(rootOffset, path);
  }

  private hasHeader() {
    if (this.bytes.length < 12) {
      return false;
    }
    return FILE_HEADER.every((byte, index) => this.bytes[index] === byte);
  }

  private locateValue(offset: number, path: RtonOffsetPathSegment[]): number | null {
    if (path.length === 0) {
      return offset;
    }

    const tag = this.byteAt(offset);
    if (tag === TAG_OBJECT_BEGIN || tag === TAG_COMPACT_OBJECT_BEGIN) {
      return this.locateInObject(offset + 1, path);
    }
    if (tag === TAG_ARRAY_BEGIN) {
      return this.locateInStandardArray(offset + 1, path);
    }
    if (tag === TAG_COMPACT_ARRAY_BEGIN) {
      return this.locateInCompactArray(offset + 1, path);
    }
    return null;
  }

  private locateInObject(offset: number, path: RtonOffsetPathSegment[]) {
    const [segment, ...rest] = path;
    if (segment?.kind !== 'object') {
      return null;
    }

    let cursor = offset;
    let entryIndex = 0;
    while (cursor < this.bytes.length) {
      const tag = this.byteAt(cursor);
      if (tag === TAG_OBJECT_END || this.isFooterAt(cursor)) {
        return null;
      }

      cursor = this.skipValue(cursor);
      const valueOffset = cursor;
      if (entryIndex === segment.index) {
        return this.locateValue(valueOffset, rest);
      }

      cursor = this.skipValue(valueOffset);
      entryIndex += 1;
    }
    return null;
  }

  private locateInStandardArray(offset: number, path: RtonOffsetPathSegment[]) {
    const [segment, ...rest] = path;
    if (segment?.kind !== 'array') {
      return null;
    }

    let cursor = offset;
    if (this.byteAt(cursor) !== TAG_ARRAY_CAPACITY) {
      return null;
    }
    cursor += 1;
    const capacity = this.readVarint(cursor);
    cursor = capacity.nextOffset;

    let index = 0;
    while (cursor < this.bytes.length && index < capacity.value) {
      if (this.byteAt(cursor) === TAG_ARRAY_END) {
        return null;
      }
      if (index === segment.index) {
        return this.locateValue(cursor, rest);
      }
      cursor = this.skipValue(cursor);
      index += 1;
    }
    return null;
  }

  private locateInCompactArray(offset: number, path: RtonOffsetPathSegment[]) {
    const [segment, ...rest] = path;
    if (segment?.kind !== 'array') {
      return null;
    }

    let cursor = offset;
    if (this.byteAt(cursor) !== TAG_ARRAY_CAPACITY) {
      return null;
    }
    cursor += 1;
    const count = this.readU32(cursor);
    cursor += 4;
    if (segment.index >= count) {
      return null;
    }

    const tableOffset = cursor;
    const targetOffset = this.readU32(tableOffset + segment.index * 4);
    if (targetOffset !== 0) {
      return this.locateValue(targetOffset, rest);
    }

    cursor += (count + 1) * 4;
    for (let index = 0; index < count; index += 1) {
      if (index === segment.index) {
        return this.locateValue(cursor, rest);
      }
      cursor = this.skipValue(cursor);
    }
    return null;
  }

  private skipValue(offset: number): number {
    const tag = this.byteAt(offset);
    let cursor = offset + 1;

    switch (tag) {
      case TAG_BOOLEAN_FALSE:
      case TAG_BOOLEAN_TRUE:
      case TAG_STRING_ASTERISK:
      case TAG_I8_ZERO:
      case TAG_U8_ZERO:
      case TAG_I16_ZERO:
      case TAG_U16_ZERO:
      case TAG_I32_ZERO:
      case TAG_U32_ZERO:
      case TAG_I64_ZERO:
      case TAG_U64_ZERO:
      case TAG_F32_ZERO:
      case TAG_F64_ZERO:
      case TAG_RTID_NULL:
        return cursor;
      case TAG_I8:
      case TAG_U8:
      case TAG_COMPACT_BOOLEAN:
        return cursor + 1;
      case TAG_I16:
      case TAG_U16:
        return cursor + 2;
      case TAG_I32:
      case TAG_U32:
      case TAG_F32:
        return cursor + 4;
      case TAG_I64:
      case TAG_U64:
      case TAG_F64:
        return cursor + 8;
      case TAG_RAW_VARINT_32:
      case TAG_ZIGZAG_VARINT_32:
      case TAG_UNSIGNED_VARINT_32:
      case TAG_RAW_VARINT_64:
      case TAG_ZIGZAG_VARINT_64:
      case TAG_UNSIGNED_VARINT_64:
        return this.readVarint(cursor).nextOffset;
      case TAG_STRING_LATIN1_DIRECT:
      case TAG_STRING_LATIN1_DEFINITION:
        return this.skipLatin1StringPayload(cursor);
      case TAG_STRING_LATIN1_REFERENCE:
      case TAG_STRING_UTF8_REFERENCE:
        return this.readVarint(cursor).nextOffset;
      case TAG_STRING_UTF8_DIRECT:
      case TAG_STRING_UTF8_DEFINITION:
        return this.skipUtf8StringPayload(cursor);
      case TAG_BINARY_BLOB:
        cursor += 1;
        cursor = this.skipLatin1StringPayload(cursor);
        {
          const len = this.readVarint(cursor);
          return len.nextOffset + len.value;
        }
      case TAG_RTID:
      case TAG_COMPACT_RTID:
        return this.skipRtidPayload(cursor);
      case TAG_OBJECT_BEGIN:
      case TAG_COMPACT_OBJECT_BEGIN:
        return this.skipObject(cursor);
      case TAG_ARRAY_BEGIN:
        return this.skipStandardArray(cursor);
      case TAG_COMPACT_ARRAY_BEGIN:
        return this.skipCompactArray(cursor);
      case TAG_COMPACT_BINARY_BLOB:
        cursor = this.skipCompactBinaryBlobString(cursor);
        return cursor + 4 + this.readU32(cursor);
      case TAG_COMPACT_LATIN1_DEFINITION:
        return this.skipCompactLatin1Definition(cursor, false);
      case TAG_COMPACT_LATIN1_REFERENCE:
        return cursor + 4;
      case TAG_COMPACT_UTF32_DEFINITION:
        return this.skipCompactUtf32Definition(cursor, false);
      case TAG_COMPACT_UTF32_REFERENCE:
        return cursor + 4;
      case TAG_COMPACT_LATIN1_DEFINITION_WITH_VALUE_OFFSET:
        return this.skipCompactLatin1Definition(cursor, true);
      case TAG_COMPACT_LATIN1_REFERENCE_WITH_VALUE_OFFSET:
        return cursor + 8;
      case TAG_COMPACT_UTF32_DEFINITION_WITH_VALUE_OFFSET:
        return this.skipCompactUtf32Definition(cursor, true);
      case TAG_COMPACT_UTF32_REFERENCE_WITH_VALUE_OFFSET:
        return cursor + 8;
      default:
        throw new Error(`Unknown RTON tag 0x${tag.toString(16)} at offset ${offset}`);
    }
  }

  private skipObject(offset: number) {
    let cursor = offset;
    while (cursor < this.bytes.length) {
      if (this.byteAt(cursor) === TAG_OBJECT_END) {
        return cursor + 1;
      }
      cursor = this.skipValue(cursor);
      cursor = this.skipValue(cursor);
    }
    throw new Error('Unterminated RTON object');
  }

  private skipStandardArray(offset: number) {
    let cursor = offset;
    if (this.byteAt(cursor) !== TAG_ARRAY_CAPACITY) {
      throw new Error('Missing RTON array capacity tag');
    }
    cursor += 1;
    const capacity = this.readVarint(cursor);
    cursor = capacity.nextOffset;

    for (let index = 0; index < capacity.value; index += 1) {
      if (this.byteAt(cursor) === TAG_ARRAY_END) {
        return cursor + 1;
      }
      cursor = this.skipValue(cursor);
    }
    return this.byteAt(cursor) === TAG_ARRAY_END ? cursor + 1 : cursor;
  }

  private skipCompactArray(offset: number) {
    let cursor = offset;
    if (this.byteAt(cursor) !== TAG_ARRAY_CAPACITY) {
      throw new Error('Missing compact RTON array capacity tag');
    }
    cursor += 1;
    const count = this.readU32(cursor);
    cursor += 4 + (count + 1) * 4;
    for (let index = 0; index < count; index += 1) {
      cursor = this.skipValue(cursor);
    }
    return cursor;
  }

  private skipLatin1StringPayload(offset: number) {
    const len = this.readVarint(offset);
    return len.nextOffset + len.value;
  }

  private skipUtf8StringPayload(offset: number) {
    let cursor = this.readVarint(offset).nextOffset;
    const byteLen = this.readVarint(cursor);
    return byteLen.nextOffset + byteLen.value;
  }

  private skipRtidPayload(offset: number) {
    let cursor = offset;
    const subTag = this.byteAt(cursor);
    cursor += 1;
    if (subTag === 0x00) {
      return cursor;
    }
    if (subTag === 0x01) {
      cursor = this.readVarint(cursor).nextOffset;
      cursor = this.readVarint(cursor).nextOffset;
      return cursor + 4;
    }
    if (subTag === 0x02) {
      cursor = this.skipUtf8StringPayload(cursor);
      cursor = this.readVarint(cursor).nextOffset;
      cursor = this.readVarint(cursor).nextOffset;
      return cursor + 4;
    }
    if (subTag === 0x03) {
      cursor = this.skipUtf8StringPayload(cursor);
      return this.skipUtf8StringPayload(cursor);
    }
    throw new Error(`Unknown RTID payload tag 0x${subTag.toString(16)}`);
  }

  private skipCompactBinaryBlobString(offset: number) {
    const tag = this.byteAt(offset);
    const cursor = offset + 1;
    if (tag === TAG_COMPACT_LATIN1_DEFINITION) {
      return this.skipCompactLatin1Definition(cursor, false);
    }
    if (tag === TAG_COMPACT_LATIN1_REFERENCE) {
      return cursor + 4;
    }
    return cursor;
  }

  private skipCompactLatin1Definition(offset: number, paired: boolean) {
    const len = this.readU32(offset);
    return offset + 4 + len + (paired ? 4 : 0);
  }

  private skipCompactUtf32Definition(offset: number, paired: boolean) {
    const len = this.readU32(offset);
    return offset + 4 + len + (paired ? 4 : 0);
  }

  private readVarint(offset: number) {
    let cursor = offset;
    let value = 0;
    let shift = 0;
    while (cursor < this.bytes.length) {
      const byte = this.bytes[cursor];
      cursor += 1;
      value += (byte & 0x7f) * 2 ** shift;
      if ((byte & 0x80) === 0) {
        return { value, nextOffset: cursor };
      }
      shift += 7;
    }
    throw new Error('Unexpected end of RTON varint');
  }

  private readU32(offset: number) {
    this.assertRange(offset, 4);
    return (
      this.bytes[offset] |
      (this.bytes[offset + 1] << 8) |
      (this.bytes[offset + 2] << 16) |
      (this.bytes[offset + 3] << 24)
    ) >>> 0;
  }

  private byteAt(offset: number) {
    this.assertRange(offset, 1);
    return this.bytes[offset];
  }

  private isFooterAt(offset: number) {
    return FILE_FOOTER.every((byte, index) => this.bytes[offset + index] === byte);
  }

  private assertRange(offset: number, length: number) {
    if (offset < 0 || offset + length > this.bytes.length) {
      throw new Error('Unexpected end of RTON bytes');
    }
  }
}
