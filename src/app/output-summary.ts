import {
  formatRtonEncoding,
  isPendingTextPreview,
  type EditorSurface,
  type RtonBinaryEncoding,
  type ViewMode,
} from '../domain/rton-codec';
import { formatBytes } from '../files/file-export';
import type { Translator } from '../localization/i18n';

export function buildOutputText({
  binaryBytes,
  binaryEncoding,
  editorSurface,
  editorText,
  hasActiveFile,
  lastOutputBytes,
  surfaceNote,
  targetBinaryEncoding,
  t,
  viewMode,
}: {
  binaryBytes: Uint8Array | null;
  binaryEncoding: RtonBinaryEncoding | null;
  editorSurface: EditorSurface;
  editorText: string;
  hasActiveFile: boolean;
  lastOutputBytes: number | null;
  surfaceNote: string;
  targetBinaryEncoding: RtonBinaryEncoding;
  t: Translator;
  viewMode: ViewMode;
}) {
  if (!hasActiveFile) {
    return t('app.noOutput');
  }

  if (editorSurface === 'hex') {
    return buildRtonOutputText({ binaryBytes, binaryEncoding, lastOutputBytes, targetBinaryEncoding, t });
  }

  return buildTextOutputText({ editorText, surfaceNote, t, viewMode });
}

function buildRtonOutputText({
  binaryBytes,
  binaryEncoding,
  lastOutputBytes,
  targetBinaryEncoding,
  t,
}: {
  binaryBytes: Uint8Array | null;
  binaryEncoding: RtonBinaryEncoding | null;
  lastOutputBytes: number | null;
  targetBinaryEncoding: RtonBinaryEncoding;
  t: Translator;
}) {
  if (binaryBytes) {
    const encoding = binaryEncoding ?? targetBinaryEncoding;
    return `${formatBytes(binaryBytes.byteLength)} · ${formatRtonEncoding(encoding, t)} RTON`;
  }

  if (lastOutputBytes !== null) {
    return `${formatBytes(lastOutputBytes)} · ${formatRtonEncoding(targetBinaryEncoding, t)} RTON`;
  }

  return t('app.notGenerated');
}

function buildTextOutputText({
  editorText,
  surfaceNote,
  t,
  viewMode,
}: {
  editorText: string;
  surfaceNote: string;
  t: Translator;
  viewMode: ViewMode;
}) {
  const label = viewMode.toUpperCase();
  if (isPendingTextPreview(editorText)) {
    return surfaceNote || t('format.generatingPreview', { label });
  }

  if (!editorText) {
    return t('app.notGenerated');
  }

  return `${formatBytes(utf8ByteLength(editorText))} · ${label}`;
}

function utf8ByteLength(text: string) {
  let bytes = 0;
  for (let index = 0; index < text.length; index += 1) {
    const code = text.charCodeAt(index);
    if (code <= 0x7f) {
      bytes += 1;
    } else if (code <= 0x7ff) {
      bytes += 2;
    } else if (code >= 0xd800 && code <= 0xdbff && index + 1 < text.length) {
      const next = text.charCodeAt(index + 1);
      if (next >= 0xdc00 && next <= 0xdfff) {
        bytes += 4;
        index += 1;
      } else {
        bytes += 3;
      }
    } else {
      bytes += 3;
    }
  }
  return bytes;
}
