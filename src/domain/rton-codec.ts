import type { StructuredFormatMode } from './format-conversion';
import { loadableFileKindLabel, type LoadableFileCandidate } from '../files/file-loading';
import { t as translate, type Translator } from '../localization/i18n';
import {
  decodeRtonValueWire,
  encodeRtonValueWire,
  rtonValueToPlain,
  type RtonValue,
} from './rton-value';
import {
  decode_rton_to_value,
  decrypt_rton_data,
  encode_value_to_rton,
  encrypt_rton_data,
  json_text_to_value,
  value_to_json_text,
} from '../wasm/rton-editor/rton_editor_wasm';
import type { Stats } from './rton-value-analysis';

export type JsonScalar = string | number | boolean | null;
export type JsonValue = JsonScalar | JsonValue[] | { [key: string]: JsonValue };
export type ViewMode = 'json' | StructuredFormatMode;
export type EditorSurface = 'text' | 'hex';
export type Tone = 'ok' | 'warn' | 'error';
export type StatusState = { message: string; tone: Tone };

export type RtonBinaryEncoding = {
  compact: boolean;
  encrypted: boolean;
};

export type DecodedLoadableSource = {
  value: RtonValue;
  editorText: string;
  surfaceNote: string;
  sourceBytes: Uint8Array | null;
  binaryBytes: Uint8Array | null;
  binaryEncoding: RtonBinaryEncoding | null;
  viewMode: ViewMode;
  editorSurface: EditorSurface;
  status: StatusState;
  stats?: Stats;
  parsedJson?: JsonValue | null;
  needsTextPreview?: boolean;
};

export function isEncryptedRtonBytes(bytes: Uint8Array) {
  return bytes.length >= 2 && bytes[0] === 0x10 && bytes[1] === 0x00;
}

export function isCompactRtonBytes(bytes: Uint8Array) {
  if (bytes.length < 9 || bytes[0] !== 0x52 || bytes[1] !== 0x54 || bytes[2] !== 0x4f || bytes[3] !== 0x4e) {
    return false;
  }
  const versionHigh = bytes[6] | (bytes[7] << 8);
  return versionHigh === 1 && bytes[8] === 0xb8;
}

export function sameRtonEncoding(left: RtonBinaryEncoding, right: RtonBinaryEncoding) {
  return left.compact === right.compact && left.encrypted === right.encrypted;
}

export function formatRtonEncoding(encoding: RtonBinaryEncoding, t?: Translator) {
  const encryptedLabel = t ? t('toolbar.encrypted') : translate('toolbar.encrypted');
  return `${encoding.compact ? 'Compact' : 'Standard'}${encoding.encrypted ? ` · ${encryptedLabel}` : ''}`;
}

export function parseJsonTextToRtonValue(json: string) {
  return decodeRtonValueWire(json_text_to_value(json));
}

export function rtonValueToJsonText(value: RtonValue, pretty: boolean) {
  return value_to_json_text(encodeRtonValueWire(value), pretty);
}

export function encodeRtonOutputBytes(value: RtonValue, compact: boolean, encrypted: boolean) {
  const bytes = encode_value_to_rton(encodeRtonValueWire(value), compact);
  return encrypted ? encrypt_rton_data(bytes) : bytes;
}

export function jsonPreviewUnavailableText(message: string, t: Translator = translate) {
  return t('format.previewUnavailableText', { label: 'JSON', message });
}

export function isPendingTextPreview(text: string) {
  return text === translate('format.generatingPreviewText', { label: 'JSON' })
    || text === translate('format.generatingPreviewText', { label: 'YAML' })
    || text === translate('format.generatingPreviewText', { label: 'TOML' })
    || (text.startsWith('正在后台生成 ') && text.endsWith(' 预览...'))
    || (text.startsWith('Generating ') && text.endsWith(' preview in the background...'));
}

export function rtonValueToJsonValue(value: RtonValue) {
  return rtonValueToPlain(value) as JsonValue;
}

export function decodeRtonSourceValue(bytes: Uint8Array, renderJsonPreview = true, t: Translator = translate) {
  const encrypted = isEncryptedRtonBytes(bytes);
  const plainBytes = encrypted ? decrypt_rton_data(bytes) : bytes;
  const compact = isCompactRtonBytes(plainBytes);
  const wire = decode_rton_to_value(plainBytes);
  let editorText: string;
  let surfaceNote: string;
  if (renderJsonPreview) {
    try {
      editorText = value_to_json_text(wire, true);
      surfaceNote = t('format.jsonEditable');
    } catch (error) {
      editorText = jsonPreviewUnavailableText(errorMessage(error), t);
      surfaceNote = t('format.jsonPreviewUnavailable');
    }
  } else {
    editorText = '';
    surfaceNote = t('format.jsonNotGenerated');
  }

  return {
    value: decodeRtonValueWire(wire),
    editorText,
    surfaceNote,
    plainBytes,
    compact,
    encrypted,
  };
}

export async function decodeLoadableSource(
  candidate: LoadableFileCandidate,
  preferredViewMode: ViewMode = 'json',
  preferredEditorSurface: EditorSurface = 'hex',
  t: Translator = translate,
): Promise<DecodedLoadableSource> {
  if (candidate.kind === 'rton') {
    const bytes = new Uint8Array(await candidate.file.arrayBuffer());
    const useHexSurface = preferredEditorSurface === 'hex';
    const { value, encrypted, compact, plainBytes } = decodeRtonSourceValue(bytes, false, t);
    const binaryEncoding = { compact, encrypted: false };
    const label = loadableFileKindLabel(preferredViewMode);
    const editorText = useHexSurface ? '' : t('format.generatingPreviewText', { label });
    const textSurfaceNote = useHexSurface ? t('app.notGenerated') : t('format.generatingPreview', { label });

    return {
      value,
      editorText: useHexSurface ? '' : editorText,
      surfaceNote: useHexSurface ? t('format.rtonEditable') : textSurfaceNote,
      sourceBytes: bytes,
      binaryBytes: plainBytes,
      binaryEncoding,
      viewMode: preferredViewMode,
      editorSurface: useHexSurface ? 'hex' : 'text',
      status: { message: encrypted ? t('status.encryptedRtonParsed') : t('format.parsed', { label: 'RTON' }), tone: 'ok' },
      needsTextPreview: !useHexSurface,
    };
  }

  const text = await candidate.file.text();
  if (candidate.kind === 'json') {
    return {
      value: parseJsonTextToRtonValue(text),
      editorText: text,
      surfaceNote: t('format.jsonEditable'),
      sourceBytes: null,
      binaryBytes: null,
      binaryEncoding: null,
      viewMode: 'json',
      editorSurface: 'text',
      status: { message: t('format.parsed', { label: 'JSON' }), tone: 'ok' },
    };
  }

  const { parseStructuredText } = await import('./format-conversion');
  const { value } = parseStructuredText(text, candidate.kind);
  const label = loadableFileKindLabel(candidate.kind);
  return {
    value,
    editorText: text,
    surfaceNote: t('format.editable', { label }),
    sourceBytes: null,
    binaryBytes: null,
    binaryEncoding: null,
    viewMode: candidate.kind,
    editorSurface: 'text',
    status: { message: t('format.parsed', { label }), tone: 'ok' },
  };
}

function errorMessage(error: unknown) {
  return error instanceof Error ? error.message : String(error);
}
