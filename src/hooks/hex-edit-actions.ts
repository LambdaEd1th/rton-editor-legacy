import { useCallback } from 'react';
import type { Translator } from '../localization/i18n';
import { collectStats, emptyStats, type Stats } from '../domain/rton-value-analysis';
import type { SearchState } from '../domain/rton-value-editing';
import {
  decodeRtonSourceValue,
  encodeRtonOutputBytes,
  rtonValueToJsonValue,
  type JsonValue,
  type RtonBinaryEncoding,
  type Tone,
  type ViewMode,
} from '../domain/rton-codec';
import type { RtonValue } from '../domain/rton-value';

export function useHexEditActions({
  activeTabId,
  binaryBytes,
  clearPendingWork,
  compactOutput,
  currentValueRef,
  invalidateFormatWork,
  parseError,
  renderTextForValue,
  setBinaryBytes,
  setBinaryEncoding,
  setCurrentValueState,
  setEditorSurface,
  setLastOutputBytes,
  setParseError,
  setParsedJson,
  setSearchState,
  setSourceBytes,
  setStats,
  setSurfaceNote,
  t,
  updateStatus,
  viewModeRef,
}: {
  activeTabId: number | null;
  binaryBytes: Uint8Array | null;
  clearPendingWork: () => void;
  compactOutput: boolean;
  currentValueRef: { current: RtonValue | null };
  invalidateFormatWork: () => void;
  parseError: string | null;
  renderTextForValue: (value: RtonValue, mode: ViewMode) => boolean;
  setBinaryBytes: (bytes: Uint8Array | null) => void;
  setBinaryEncoding: (encoding: RtonBinaryEncoding | null) => void;
  setCurrentValueState: (value: RtonValue | null) => void;
  setEditorSurface: (surface: 'text' | 'hex') => void;
  setLastOutputBytes: (bytes: number | null) => void;
  setParseError: (message: string | null) => void;
  setParsedJson: (value: JsonValue | null) => void;
  setSearchState: (state: SearchState) => void;
  setSourceBytes: (bytes: Uint8Array | null) => void;
  setStats: (stats: Stats) => void;
  setSurfaceNote: (note: string) => void;
  t: Translator;
  updateStatus: (message: string, tone?: Tone) => void;
  viewModeRef: { current: ViewMode };
}) {
  const openHexEditor = useCallback(() => {
    if (activeTabId === null) {
      updateStatus(t('status.openFileFirst'), 'warn');
      return;
    }

    if (binaryBytes) {
      setEditorSurface('hex');
      setSurfaceNote(t('format.rtonEditable'));
      return;
    }

    const value = currentValueRef.current;
    if (!value) {
      updateStatus(parseError ?? t('status.noSearchableValue'), 'error');
      return;
    }

    try {
      const bytes = encodeRtonOutputBytes(value, compactOutput, false);
      setBinaryBytes(bytes);
      setBinaryEncoding({ compact: compactOutput, encrypted: false });
      setSourceBytes(bytes);
      setLastOutputBytes(null);
      setEditorSurface('hex');
      setSurfaceNote(t('format.rtonEditable'));
      updateStatus(t('status.rtonBinaryGenerated'), 'ok');
    } catch (error) {
      updateStatus(errorMessage(error), 'error');
    }
  }, [
    activeTabId,
    binaryBytes,
    compactOutput,
    currentValueRef,
    parseError,
    setBinaryBytes,
    setBinaryEncoding,
    setEditorSurface,
    setLastOutputBytes,
    setSourceBytes,
    setSurfaceNote,
    t,
    updateStatus,
  ]);

  const onHexBytesChange = useCallback(
    (nextBytes: Uint8Array) => {
      if (activeTabId === null) {
        return;
      }

      clearPendingWork();
      setBinaryBytes(nextBytes);
      setSourceBytes(nextBytes);
      setLastOutputBytes(null);

      try {
        const { value, encrypted, compact, plainBytes } = decodeRtonSourceValue(nextBytes);
        setBinaryBytes(plainBytes);
        setSourceBytes(plainBytes);
        setCurrentValueState(value);
        setParsedJson(rtonValueToJsonValue(value));
        setParseError(null);
        setStats(collectStats(value));
        setBinaryEncoding({ compact, encrypted: false });
        setSearchState({ kind: 'idle' });
        renderTextForValue(value, viewModeRef.current);
        setSurfaceNote(t('format.rtonEditable'));
        updateStatus(t('status.rtonUpdated', { prefix: encrypted ? `${t('toolbar.encrypted')} ` : '' }), 'ok');
      } catch (error) {
        const message = errorMessage(error);
        invalidateFormatWork();
        setCurrentValueState(null);
        setParsedJson(null);
        setParseError(message);
        setStats(emptyStats());
        setSearchState({ kind: 'message', message });
        setSurfaceNote(t('format.rtonParseUnavailable'));
        updateStatus(t('status.rtonUpdateFailed', { message }), 'error');
      }
    },
    [
      activeTabId,
      clearPendingWork,
      invalidateFormatWork,
      renderTextForValue,
      setBinaryBytes,
      setBinaryEncoding,
      setCurrentValueState,
      setLastOutputBytes,
      setParseError,
      setParsedJson,
      setSearchState,
      setSourceBytes,
      setStats,
      setSurfaceNote,
      t,
      updateStatus,
      viewModeRef,
    ],
  );

  return {
    onHexBytesChange,
    openHexEditor,
  };
}

function errorMessage(error: unknown) {
  return error instanceof Error ? error.message : String(error);
}
