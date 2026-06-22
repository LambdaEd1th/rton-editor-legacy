import { t as translate } from '../localization/i18n';
import type { RtonIntegerKind, RtonValue } from './rton-value';

export type RtonValuePathSegment = { kind: 'array'; index: number } | { kind: 'object'; index: number };
export type RtonValuePath = RtonValuePathSegment[];

export type SearchMatch = {
  path: string;
  preview: string;
  valuePath: RtonValuePath;
};

export type SearchState =
  | { kind: 'idle' }
  | { kind: 'message'; message: string }
  | { kind: 'results'; query: string; matches: SearchMatch[]; scanned: number; done: boolean; capped: boolean };

const RTON_INTEGER_RANGES: Record<RtonIntegerKind, readonly [bigint, bigint]> = {
  i8: [-128n, 127n],
  u8: [0n, 255n],
  i16: [-32768n, 32767n],
  u16: [0n, 65535n],
  i32: [-2147483648n, 2147483647n],
  u32: [0n, 4294967295n],
  i64: [-9223372036854775808n, 9223372036854775807n],
  u64: [0n, 18446744073709551615n],
  'var-i32': [-2147483648n, 2147483647n],
  'var-u32': [0n, 4294967295n],
  'var-i64': [-9223372036854775808n, 9223372036854775807n],
  'var-u64': [0n, 18446744073709551615n],
};

export function isRtonIntegerKind(kind: RtonValue['kind']): kind is RtonIntegerKind {
  return kind in RTON_INTEGER_RANGES;
}

export function isRtonNumberKind(kind: RtonValue['kind']) {
  return isRtonIntegerKind(kind) || kind === 'f32' || kind === 'f64';
}

export function previewRtonValue(value: RtonValue): string {
  if (value.kind === 'array') {
    return `array(${value.items.length})`;
  }
  if (value.kind === 'object') {
    return `object(${value.entries.length})`;
  }
  return `${value.kind}: ${rtonScalarPreview(value)}`;
}

export function rtonValueClass(value: RtonValue): string {
  if (value.kind === 'rtid') {
    return 'text-[var(--color-accent-text)]';
  }
  if (value.kind === 'binary') {
    return 'text-[var(--color-rton-binary)]';
  }
  if (value.kind === 'string') {
    return 'text-[var(--color-rton-string)]';
  }
  if (isRtonNumberKind(value.kind)) {
    return 'text-[var(--color-rton-number)]';
  }
  if (value.kind === 'bool') {
    return 'text-[var(--color-rton-bool)]';
  }
  return 'text-[var(--color-text-subtle)]';
}

export function rtonScalarEditText(value: RtonValue) {
  switch (value.kind) {
    case 'null':
      return 'null';
    case 'bool':
      return String(value.value);
    case 'f32':
    case 'f64':
      return formatRtonFloat(value.value);
    case 'string':
    case 'binary':
    case 'rtid':
      return value.value;
    case 'array':
      return `array(${value.items.length})`;
    case 'object':
      return `object(${value.entries.length})`;
    default:
      return value.value;
  }
}

export function rtonScalarPreview(value: RtonValue) {
  const text = rtonScalarEditText(value);
  return text.length > 96 ? `${text.slice(0, 93)}...` : text;
}

export function updateRtonScalarText(value: RtonValue, text: string): RtonValue {
  if (isRtonIntegerKind(value.kind)) {
    return { kind: value.kind, value: parseRtonIntegerText(text, value.kind) };
  }

  switch (value.kind) {
    case 'f32':
    case 'f64':
      return { kind: value.kind, value: parseRtonFloatText(text) };
    case 'string':
    case 'binary':
    case 'rtid':
      return { kind: value.kind, value: text };
    default:
      return value;
  }
}

export function convertRtonValueKind(value: RtonValue, nextKind: RtonValue['kind']): RtonValue {
  if (value.kind === nextKind) {
    return value;
  }

  if (nextKind === 'array') {
    return { kind: 'array', items: value.kind === 'array' ? value.items : [] };
  }
  if (nextKind === 'object') {
    return { kind: 'object', entries: value.kind === 'object' ? value.entries : [] };
  }
  if (nextKind === 'null') {
    return { kind: 'null' };
  }
  if (nextKind === 'bool') {
    return { kind: 'bool', value: value.kind === 'bool' ? value.value : false };
  }

  const text = rtonScalarEditText(value);
  const defaultValue = defaultRtonValue(nextKind);
  try {
    return updateRtonScalarText(defaultValue, text);
  } catch {
    return defaultValue;
  }
}

function defaultRtonValue(kind: Exclude<RtonValue['kind'], 'array' | 'object'>): RtonValue {
  if (isRtonIntegerKind(kind)) {
    return { kind, value: '0' };
  }

  switch (kind) {
    case 'null':
      return { kind: 'null' };
    case 'bool':
      return { kind: 'bool', value: false };
    case 'f32':
    case 'f64':
      return { kind, value: 0 };
    case 'binary':
      return { kind: 'binary', value: '$BINARY("", 0)' };
    case 'rtid':
      return { kind: 'rtid', value: 'RTID(0)' };
    case 'string':
      return { kind: 'string', value: '' };
  }
}

function parseRtonIntegerText(text: string, kind: RtonIntegerKind) {
  const trimmed = text.trim();
  if (!/^[+-]?\d+$/.test(trimmed)) {
    throw new Error(translate('error.integerRequired', { kind }));
  }

  const value = BigInt(trimmed);
  const [min, max] = RTON_INTEGER_RANGES[kind];
  if (value < min || value > max) {
    throw new Error(translate('error.integerOutOfRange', { kind, min: min.toString(), max: max.toString() }));
  }
  return value.toString();
}

function parseRtonFloatText(text: string) {
  const normalized = text.trim().toLowerCase();
  if (['inf', '+inf', 'infinity', '+infinity', '.inf', '+.inf'].includes(normalized)) {
    return Infinity;
  }
  if (['-inf', '-infinity', '-.inf'].includes(normalized)) {
    return -Infinity;
  }
  if (['nan', '+nan', '-nan', '.nan', '+.nan', '-.nan'].includes(normalized)) {
    return NaN;
  }

  const value = Number(text);
  if (Number.isNaN(value)) {
    throw new Error(translate('error.floatRequired'));
  }
  return value;
}

function formatRtonFloat(value: number) {
  if (Number.isNaN(value)) {
    return 'nan';
  }
  if (value === Infinity) {
    return 'inf';
  }
  if (value === -Infinity) {
    return '-inf';
  }
  return String(value);
}

export function replaceRtonValueAtPath(root: RtonValue, path: RtonValuePath, nextValue: RtonValue): RtonValue {
  if (path.length === 0) {
    return nextValue;
  }

  const [head, ...tail] = path;
  if (head.kind === 'array') {
    if (root.kind !== 'array' || head.index < 0 || head.index >= root.items.length) {
      throw new Error(translate('error.valuePathInvalid'));
    }
    const items = [...root.items];
    items[head.index] = replaceRtonValueAtPath(items[head.index], tail, nextValue);
    return { kind: 'array', items };
  }

  if (root.kind !== 'object' || head.index < 0 || head.index >= root.entries.length) {
    throw new Error(translate('error.valuePathInvalid'));
  }
  const entries = [...root.entries];
  const entry = entries[head.index];
  entries[head.index] = { ...entry, value: replaceRtonValueAtPath(entry.value, tail, nextValue) };
  return { kind: 'object', entries };
}
