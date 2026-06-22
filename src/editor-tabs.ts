import { t as translate, type Translator } from './localization/i18n';
import {
  jsonPreviewUnavailableText,
  rtonValueToJsonText,
  rtonValueToJsonValue,
  type EditorSurface,
  type JsonValue,
  type RtonBinaryEncoding,
  type StatusState,
  type ViewMode,
} from './rton-codec';
import type { RtonValue } from './rton-value';
import { collectStats, emptyStats, type Stats } from './rton-value-analysis';
import type { SearchState } from './rton-value-editing';

export type EditorTab = {
  id: number;
  fileName: string;
  sourceBytes: Uint8Array | null;
  binaryBytes: Uint8Array | null;
  binaryEncoding: RtonBinaryEncoding | null;
  currentValue: RtonValue | null;
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
  viewMode = 'json',
  editorSurface = 'text',
  status,
}: {
  id: number;
  fileName: string;
  value: RtonValue;
  editorText?: string;
  surfaceNote?: string;
  sourceBytes: Uint8Array | null;
  binaryBytes?: Uint8Array | null;
  binaryEncoding?: RtonBinaryEncoding | null;
  viewMode?: ViewMode;
  editorSurface?: EditorSurface;
  status: StatusState;
}, t: Translator = translate): EditorTab {
  const actualBinaryBytes = binaryBytes ?? sourceBytes;
  const actualEditorSurface = editorSurface === 'hex' && actualBinaryBytes ? 'hex' : 'text';

  try {
    const plainValue = rtonValueToJsonValue(value);
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
      editorText: text,
      lastOutputBytes: null,
      parsedJson: plainValue,
      parseError: null,
      stats: collectStats(value),
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
      editorText: editorText ?? '',
      lastOutputBytes: null,
      parsedJson: null,
      parseError: message,
      stats: emptyStats(),
      viewMode,
      editorSurface: actualEditorSurface,
      surfaceNote: surfaceNote ?? t('format.parseFailed', { label: viewMode.toUpperCase(), message }),
      searchQuery: '',
      searchState: { kind: 'message', message },
      status: { message, tone: 'error' },
    };
  }
}

function errorMessage(error: unknown) {
  return error instanceof Error ? error.message : String(error);
}
