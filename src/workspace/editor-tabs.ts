import { t as translate, type Translator } from '../localization/i18n';
import {
  jsonPreviewUnavailableText,
  rtonValueToJsonText,
  type EditorSurface,
  type JsonValue,
  type RtonBinaryEncoding,
  type StatusState,
  type ViewMode,
} from '../domain/rton-codec';
import type { RtonValue } from '../domain/rton-value';
import { collectStats, emptyStats, type Stats } from '../domain/rton-value-analysis';
import type { SearchState } from '../domain/rton-value-editing';
import type { RtonDocumentRef } from '../domain/rton-document';

export type EditorTab = {
  id: number;
  fileName: string;
  sourceBytes: Uint8Array | null;
  binaryBytes: Uint8Array | null;
  binaryEncoding: RtonBinaryEncoding | null;
  currentValue: RtonValue | null;
  rtonDocument: RtonDocumentRef | null;
  editorText: string;
  lastOutputBytes: number | null;
  parsedJson: JsonValue | null;
  parseError: string | null;
  stats: Stats;
  viewMode: ViewMode;
  editorSurface: EditorSurface;
  surfaceNote: string;
  searchQuery: string;
  searchState: SearchState;
  status: StatusState;
};

export function createEditorTabFromValue({
  id,
  fileName,
  value,
  editorText,
  surfaceNote,
  sourceBytes,
  binaryBytes,
  binaryEncoding,
  rtonDocument = null,
  viewMode = 'json',
  editorSurface = 'text',
  status,
  stats,
  parsedJson = null,
}: {
  id: number;
  fileName: string;
  value: RtonValue;
  editorText?: string;
  surfaceNote?: string;
  sourceBytes: Uint8Array | null;
  binaryBytes?: Uint8Array | null;
  binaryEncoding?: RtonBinaryEncoding | null;
  rtonDocument?: RtonDocumentRef | null;
  viewMode?: ViewMode;
  editorSurface?: EditorSurface;
  status: StatusState;
  stats?: Stats;
  parsedJson?: JsonValue | null;
}, t: Translator = translate): EditorTab {
  const actualBinaryBytes = binaryBytes ?? sourceBytes;
  const actualEditorSurface = editorSurface === 'hex' && actualBinaryBytes ? 'hex' : 'text';

  try {
    let text = editorText;
    let note = surfaceNote ?? t('format.editable', { label: viewMode.toUpperCase() });
    if (text === undefined) {
      try {
        text = rtonValueToJsonText(value, true);
      } catch (error) {
        text = jsonPreviewUnavailableText(errorMessage(error), t);
        note = t('format.jsonPreviewUnavailable');
      }
    }

    return {
      id,
      fileName,
      sourceBytes,
      binaryBytes: actualBinaryBytes,
      binaryEncoding: actualBinaryBytes ? binaryEncoding ?? null : null,
      currentValue: value,
      rtonDocument,
      editorText: text,
      lastOutputBytes: null,
      parsedJson,
      parseError: null,
      stats: stats ?? collectStats(value),
      viewMode,
      editorSurface: actualEditorSurface,
      surfaceNote: note,
      searchQuery: '',
      searchState: { kind: 'idle' },
      status,
    };
  } catch (error) {
    const message = errorMessage(error);
    return {
      id,
      fileName,
      sourceBytes,
      binaryBytes: actualBinaryBytes,
      binaryEncoding: actualBinaryBytes ? binaryEncoding ?? null : null,
      currentValue: value,
      rtonDocument,
      editorText: editorText ?? '',
      lastOutputBytes: null,
      parsedJson,
      parseError: message,
      stats: stats ?? emptyStats(),
      viewMode,
      editorSurface: actualEditorSurface,
      surfaceNote: surfaceNote ?? t('format.parseFailed', { label: viewMode.toUpperCase(), message }),
      searchQuery: '',
      searchState: { kind: 'message', message },
      status: { message, tone: 'error' },
    };
  }
}

export function createEditorTabFromDocument({
  id,
  fileName,
  document,
  editorText = '',
  surfaceNote,
  sourceBytes,
  binaryBytes,
  binaryEncoding,
  viewMode = 'json',
  editorSurface = 'hex',
  status,
}: {
  id: number;
  fileName: string;
  document: RtonDocumentRef;
  editorText?: string;
  surfaceNote?: string;
  sourceBytes: Uint8Array | null;
  binaryBytes?: Uint8Array | null;
  binaryEncoding?: RtonBinaryEncoding | null;
  viewMode?: ViewMode;
  editorSurface?: EditorSurface;
  status: StatusState;
}): EditorTab {
  const actualBinaryBytes = binaryBytes ?? sourceBytes;
  const actualEditorSurface = editorSurface === 'hex' && actualBinaryBytes ? 'hex' : 'text';
  return {
    id,
    fileName,
    sourceBytes,
    binaryBytes: actualBinaryBytes,
    binaryEncoding: actualBinaryBytes ? binaryEncoding ?? null : null,
    currentValue: null,
    rtonDocument: document,
    editorText,
    lastOutputBytes: null,
    parsedJson: null,
    parseError: null,
    stats: document.stats,
    viewMode,
    editorSurface: actualEditorSurface,
    surfaceNote: surfaceNote ?? '',
    searchQuery: '',
    searchState: { kind: 'idle' },
    status,
  };
}

function errorMessage(error: unknown) {
  return error instanceof Error ? error.message : String(error);
}
