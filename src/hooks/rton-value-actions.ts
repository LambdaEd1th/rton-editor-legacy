import type { EditorJumpTarget } from '../components/editor/CodeEditor';
import type { HexEditorJumpTarget } from '../components/editor/HexEditor';
import type { Translator } from '../localization/i18n';
import { collectStats, type Stats } from '../domain/rton-value-analysis';
import {
  replaceRtonValueAtPath,
  type RtonValuePath,
} from '../domain/rton-value-editing';
import { locateRtonValueOffset } from '../domain/rton-offset-map';
import { locateRtonPathInText } from '../domain/rton-text-locator';
import {
  isEncryptedRtonBytes,
  rtonValueToJsonValue,
  type EditorSurface,
  type JsonValue,
  type RtonBinaryEncoding,
  type Tone,
  type ViewMode,
} from '../domain/rton-codec';
import type { RtonValue } from '../domain/rton-value';

export function useRtonValueActions({
  activeTabId,
  binaryBytes,
  currentValueRef,
  displayedHexBytes,
  editorSurface,
  editorText,
  nextEditorJumpId,
  nextHexJumpId,
  parseError,
  renderTextForValue,
  setBinaryBytes,
  setBinaryEncoding,
  setCurrentValueState,
  setEditorJumpTarget,
  setEditorSurface,
  setHexJumpTarget,
  setLastOutputBytes,
  setParseError,
  setParsedJson,
  setStats,
  t,
  updateStatus,
  viewModeRef,
}: {
  activeTabId: number | null;
  binaryBytes: Uint8Array | null;
  currentValueRef: { current: RtonValue | null };
  displayedHexBytes: Uint8Array | null;
  editorSurface: EditorSurface;
  editorText: string;
  nextEditorJumpId: { current: number };
  nextHexJumpId: { current: number };
  parseError: string | null;
  renderTextForValue: (value: RtonValue, mode: ViewMode) => boolean;
  setBinaryBytes: (bytes: Uint8Array | null) => void;
  setBinaryEncoding: (encoding: RtonBinaryEncoding | null) => void;
  setCurrentValueState: (value: RtonValue | null) => void;
  setEditorJumpTarget: (target: EditorJumpTarget | null) => void;
  setEditorSurface: (surface: EditorSurface) => void;
  setHexJumpTarget: (target: HexEditorJumpTarget | null) => void;
  setLastOutputBytes: (bytes: number | null) => void;
  setParseError: (message: string | null) => void;
  setParsedJson: (value: JsonValue | null) => void;
  setStats: (stats: Stats) => void;
  t: Translator;
  updateStatus: (message: string, tone?: Tone) => void;
  viewModeRef: { current: ViewMode };
}) {
  const updateRtonValueNode = (path: RtonValuePath, nextValue: RtonValue) => {
    if (activeTabId === null) {
      updateStatus(t('status.openFileFirst'), 'warn');
      return;
    }

    const current = currentValueRef.current;
    if (!current) {
      updateStatus(parseError ?? t('status.noSearchableValue'), 'error');
      return;
    }

    try {
      const updated = replaceRtonValueAtPath(current, path, nextValue);
      setCurrentValueState(updated);
      setParsedJson(rtonValueToJsonValue(updated));
      setParseError(null);
      setStats(collectStats(updated));
      setLastOutputBytes(null);
      setBinaryBytes(null);
      setBinaryEncoding(null);
      setEditorSurface('text');
      const rendered = renderTextForValue(updated, viewModeRef.current);
      updateStatus(rendered ? t('status.rtonValueUpdated') : t('status.rtonValueUpdatedNoJson'), rendered ? 'ok' : 'warn');
    } catch (error) {
      updateStatus(errorMessage(error), 'error');
    }
  };

  const navigateToRtonValueNode = (path: RtonValuePath) => {
    const value = currentValueRef.current;
    if (!value) {
      updateStatus(parseError ?? t('status.noSearchableValue'), 'warn');
      return;
    }

    if (editorSurface === 'hex') {
      const navigableBytes = displayedHexBytes ?? binaryBytes;
      if (!navigableBytes) {
        updateStatus(t('status.noJumpBytes'), 'warn');
        return;
      }
      if (isEncryptedRtonBytes(navigableBytes)) {
        updateStatus(t('status.encryptedOffsetUnavailable'), 'warn');
        return;
      }

      const offset = locateRtonValueOffset(navigableBytes, path);
      if (offset === null) {
        updateStatus(t('status.offsetNotFound'), 'warn');
        return;
      }

      setHexJumpTarget({
        id: nextHexJumpId.current,
        offset,
      });
      nextHexJumpId.current += 1;
      updateStatus(t('status.jumpedOffset', { offset: offset.toString(16).toUpperCase() }), 'ok');
      return;
    }

    const position = locateRtonPathInText(value, path, editorText, viewModeRef.current);
    if (!position) {
      updateStatus(t('status.textLineNotFound'), 'warn');
      return;
    }

    setEditorJumpTarget({
      id: nextEditorJumpId.current,
      line: position.line,
      column: position.column,
    });
    nextEditorJumpId.current += 1;
    updateStatus(t('status.jumpedLine', { line: position.line.toLocaleString() }), 'ok');
  };

  return {
    navigateToRtonValueNode,
    updateRtonValueNode,
  };
}

function errorMessage(error: unknown) {
  return error instanceof Error ? error.message : String(error);
}
