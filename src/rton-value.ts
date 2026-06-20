export type RtonIntegerKind =
  | 'i8'
  | 'u8'
  | 'i16'
  | 'u16'
  | 'i32'
  | 'u32'
  | 'i64'
  | 'u64'
  | 'var-i32'
  | 'var-u32'
  | 'var-i64'
  | 'var-u64';

export type RtonValue =
  | { kind: 'null' }
  | { kind: 'bool'; value: boolean }
  | { kind: RtonIntegerKind; value: string }
  | { kind: 'f32' | 'f64'; value: number }
  | { kind: 'string' | 'binary' | 'rtid'; value: string }
  | { kind: 'array'; items: RtonValue[] }
  | { kind: 'object'; entries: Array<{ key: string; value: RtonValue }> };

const WireTag = {
  Null: 0,
  Bool: 1,
  I8: 2,
  U8: 3,
  I16: 4,
  U16: 5,
  I32: 6,
  U32: 7,
  I64: 8,
  U64: 9,
  VarI32: 10,
  VarU32: 11,
  VarI64: 12,
  VarU64: 13,
  F32: 14,
  F64: 15,
  String: 16,
  Binary: 17,
  Rtid: 18,
  Array: 19,
  Object: 20,
} as const;

export function decodeRtonValueWire(bytes: Uint8Array): RtonValue {
  const reader = new WireReader(bytes);
  const value = reader.readValue();
  if (!reader.done()) {
    throw new Error('Trailing bytes after RtonValue wire payload.');
  }
  return value;
}

export function encodeRtonValueWire(value: RtonValue): Uint8Array {
  const writer = new WireWriter();
  writer.writeValue(value);
  return writer.toBytes();
}

export function rtonValueToPlain(value: RtonValue): unknown {
  switch (value.kind) {
    case 'null':
      return null;
    case 'bool':
    case 'f32':
    case 'f64':
      return value.value;
    case 'i8':
    case 'u8':
    case 'i16':
    case 'u16':
    case 'i32':
    case 'u32':
    case 'i64':
    case 'u64':
    case 'var-i32':
    case 'var-u32':
    case 'var-i64':
    case 'var-u64':
      return integerStringToPlain(value.value);
    case 'string':
    case 'binary':
    case 'rtid':
      return value.value;
    case 'array':
      return value.items.map(rtonValueToPlain);
    case 'object':
      return Object.fromEntries(value.entries.map((entry) => [entry.key, rtonValueToPlain(entry.value)]));
  }
}

export function plainToRtonValue(value: unknown): RtonValue {
  if (value === null || value === undefined) {
    return { kind: 'rtid', value: 'RTID(0)' };
  }
  if (typeof value === 'boolean') {
    return { kind: 'bool', value };
  }
  if (typeof value === 'number') {
    return numberToRtonValue(value);
  }
  if (typeof value === 'bigint') {
    return bigintToRtonValue(value);
  }
  if (typeof value === 'string') {
    if (value.startsWith('RTID(')) {
      return { kind: 'rtid', value };
    }
    if (value.startsWith('$BINARY(')) {
      return { kind: 'binary', value };
    }
    return { kind: 'string', value };
  }
  if (Array.isArray(value)) {
    return { kind: 'array', items: value.map(plainToRtonValue) };
  }
  if (typeof value === 'object') {
    return {
      kind: 'object',
      entries: Object.entries(value as Record<string, unknown>).map(([key, child]) => ({
        key,
        value: plainToRtonValue(child),
      })),
    };
  }
  return { kind: 'string', value: String(value) };
}

function numberToRtonValue(value: number): RtonValue {
  if (!Number.isFinite(value)) {
    return { kind: 'f64', value };
  }
  if (!Number.isInteger(value)) {
    return { kind: 'f64', value };
  }
  return bigintToRtonValue(BigInt(value));
}

function bigintToRtonValue(value: bigint): RtonValue {
  if (value >= -128n && value <= 127n) {
    return { kind: 'i8', value: value.toString() };
  }
  if (value >= -32768n && value <= 32767n) {
    return { kind: 'i16', value: value.toString() };
  }
  if (value >= -2147483648n && value <= 2147483647n) {
    return { kind: 'i32', value: value.toString() };
  }
  return { kind: 'i64', value: value.toString() };
}

function integerStringToPlain(value: string) {
  const number = Number(value);
  return Number.isSafeInteger(number) ? number : value;
}

class WireReader {
  private offset = 0;
  private readonly view: DataView;
  private readonly decoder = new TextDecoder();

  constructor(private readonly bytes: Uint8Array) {
    this.view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  }

  done() {
    return this.offset === this.bytes.byteLength;
  }

  readValue(): RtonValue {
    const tag = this.readU8();
    switch (tag) {
      case WireTag.Null:
        return { kind: 'null' };
      case WireTag.Bool:
        return { kind: 'bool', value: this.readU8() !== 0 };
      case WireTag.I8:
        return { kind: 'i8', value: this.readI8().toString() };
      case WireTag.U8:
        return { kind: 'u8', value: this.readU8().toString() };
      case WireTag.I16:
        return { kind: 'i16', value: this.readI16().toString() };
      case WireTag.U16:
        return { kind: 'u16', value: this.readU16().toString() };
      case WireTag.I32:
        return { kind: 'i32', value: this.readI32().toString() };
      case WireTag.U32:
        return { kind: 'u32', value: this.readU32().toString() };
      case WireTag.I64:
        return { kind: 'i64', value: this.readI64().toString() };
      case WireTag.U64:
        return { kind: 'u64', value: this.readU64().toString() };
      case WireTag.VarI32:
        return { kind: 'var-i32', value: this.readI32().toString() };
      case WireTag.VarU32:
        return { kind: 'var-u32', value: this.readU32().toString() };
      case WireTag.VarI64:
        return { kind: 'var-i64', value: this.readI64().toString() };
      case WireTag.VarU64:
        return { kind: 'var-u64', value: this.readU64().toString() };
      case WireTag.F32:
        return { kind: 'f32', value: this.readF32() };
      case WireTag.F64:
        return { kind: 'f64', value: this.readF64() };
      case WireTag.String:
        return { kind: 'string', value: this.readString() };
      case WireTag.Binary:
        return { kind: 'binary', value: this.readString() };
      case WireTag.Rtid:
        return { kind: 'rtid', value: this.readString() };
      case WireTag.Array: {
        const length = this.readLength();
        const items: RtonValue[] = [];
        for (let index = 0; index < length; index += 1) {
          items.push(this.readValue());
        }
        return { kind: 'array', items };
      }
      case WireTag.Object: {
        const length = this.readLength();
        const entries: Array<{ key: string; value: RtonValue }> = [];
        for (let index = 0; index < length; index += 1) {
          entries.push({ key: this.readString(), value: this.readValue() });
        }
        return { kind: 'object', entries };
      }
      default:
        throw new Error(`Unknown RtonValue wire tag: ${tag}`);
    }
  }

  private ensure(size: number) {
    if (this.offset + size > this.bytes.byteLength) {
      throw new Error('Unexpected end of RtonValue wire payload.');
    }
  }

  private readU8() {
    this.ensure(1);
    const value = this.view.getUint8(this.offset);
    this.offset += 1;
    return value;
  }

  private readI8() {
    this.ensure(1);
    const value = this.view.getInt8(this.offset);
    this.offset += 1;
    return value;
  }

  private readI16() {
    this.ensure(2);
    const value = this.view.getInt16(this.offset, true);
    this.offset += 2;
    return value;
  }

  private readU16() {
    this.ensure(2);
    const value = this.view.getUint16(this.offset, true);
    this.offset += 2;
    return value;
  }

  private readI32() {
    this.ensure(4);
    const value = this.view.getInt32(this.offset, true);
    this.offset += 4;
    return value;
  }

  private readU32() {
    this.ensure(4);
    const value = this.view.getUint32(this.offset, true);
    this.offset += 4;
    return value;
  }

  private readI64() {
    this.ensure(8);
    const value = this.view.getBigInt64(this.offset, true);
    this.offset += 8;
    return value;
  }

  private readU64() {
    this.ensure(8);
    const value = this.view.getBigUint64(this.offset, true);
    this.offset += 8;
    return value;
  }

  private readF32() {
    this.ensure(4);
    const value = this.view.getFloat32(this.offset, true);
    this.offset += 4;
    return value;
  }

  private readF64() {
    this.ensure(8);
    const value = this.view.getFloat64(this.offset, true);
    this.offset += 8;
    return value;
  }

  private readLength() {
    return this.readU32();
  }

  private readString() {
    const length = this.readLength();
    this.ensure(length);
    const value = this.decoder.decode(this.bytes.subarray(this.offset, this.offset + length));
    this.offset += length;
    return value;
  }
}

class WireWriter {
  private bytes: number[] = [];
  private readonly encoder = new TextEncoder();

  toBytes() {
    return new Uint8Array(this.bytes);
  }

  writeValue(value: RtonValue) {
    switch (value.kind) {
      case 'null':
        this.writeU8(WireTag.Null);
        break;
      case 'bool':
        this.writeU8(WireTag.Bool);
        this.writeU8(value.value ? 1 : 0);
        break;
      case 'i8':
        this.writeU8(WireTag.I8);
        this.writeI8(Number(value.value));
        break;
      case 'u8':
        this.writeU8(WireTag.U8);
        this.writeU8(Number(value.value));
        break;
      case 'i16':
        this.writeU8(WireTag.I16);
        this.writeI16(Number(value.value));
        break;
      case 'u16':
        this.writeU8(WireTag.U16);
        this.writeU16(Number(value.value));
        break;
      case 'i32':
        this.writeU8(WireTag.I32);
        this.writeI32(Number(value.value));
        break;
      case 'u32':
        this.writeU8(WireTag.U32);
        this.writeU32(Number(value.value));
        break;
      case 'i64':
        this.writeU8(WireTag.I64);
        this.writeI64(BigInt(value.value));
        break;
      case 'u64':
        this.writeU8(WireTag.U64);
        this.writeU64(BigInt(value.value));
        break;
      case 'var-i32':
        this.writeU8(WireTag.VarI32);
        this.writeI32(Number(value.value));
        break;
      case 'var-u32':
        this.writeU8(WireTag.VarU32);
        this.writeU32(Number(value.value));
        break;
      case 'var-i64':
        this.writeU8(WireTag.VarI64);
        this.writeI64(BigInt(value.value));
        break;
      case 'var-u64':
        this.writeU8(WireTag.VarU64);
        this.writeU64(BigInt(value.value));
        break;
      case 'f32':
        this.writeU8(WireTag.F32);
        this.writeF32(value.value);
        break;
      case 'f64':
        this.writeU8(WireTag.F64);
        this.writeF64(value.value);
        break;
      case 'string':
        this.writeU8(WireTag.String);
        this.writeString(value.value);
        break;
      case 'binary':
        this.writeU8(WireTag.Binary);
        this.writeString(value.value);
        break;
      case 'rtid':
        this.writeU8(WireTag.Rtid);
        this.writeString(value.value);
        break;
      case 'array':
        this.writeU8(WireTag.Array);
        this.writeLength(value.items.length);
        value.items.forEach((item) => this.writeValue(item));
        break;
      case 'object':
        this.writeU8(WireTag.Object);
        this.writeLength(value.entries.length);
        value.entries.forEach((entry) => {
          this.writeString(entry.key);
          this.writeValue(entry.value);
        });
        break;
    }
  }

  private writeU8(value: number) {
    this.bytes.push(value & 0xff);
  }

  private writeI8(value: number) {
    this.writeU8(value);
  }

  private writeI16(value: number) {
    this.writeDataView(2, (view) => view.setInt16(0, value, true));
  }

  private writeU16(value: number) {
    this.writeDataView(2, (view) => view.setUint16(0, value, true));
  }

  private writeI32(value: number) {
    this.writeDataView(4, (view) => view.setInt32(0, value, true));
  }

  private writeU32(value: number) {
    this.writeDataView(4, (view) => view.setUint32(0, value, true));
  }

  private writeI64(value: bigint) {
    this.writeDataView(8, (view) => view.setBigInt64(0, value, true));
  }

  private writeU64(value: bigint) {
    this.writeDataView(8, (view) => view.setBigUint64(0, value, true));
  }

  private writeF32(value: number) {
    this.writeDataView(4, (view) => view.setFloat32(0, value, true));
  }

  private writeF64(value: number) {
    this.writeDataView(8, (view) => view.setFloat64(0, value, true));
  }

  private writeLength(length: number) {
    this.writeU32(length);
  }

  private writeString(value: string) {
    const bytes = this.encoder.encode(value);
    this.writeLength(bytes.byteLength);
    this.writeBytes(bytes);
  }

  private writeBytes(bytes: Uint8Array) {
    bytes.forEach((byte) => this.bytes.push(byte));
  }

  private writeDataView(size: number, write: (view: DataView) => void) {
    const buffer = new ArrayBuffer(size);
    const view = new DataView(buffer);
    write(view);
    this.writeBytes(new Uint8Array(buffer));
  }
}
