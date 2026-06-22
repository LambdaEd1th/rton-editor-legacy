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
import type { RtonDocumentRef } from '../domain/rton-document';
import type { RtonDocumentByteUpdateOutput } from './worker-clients';

export function useHexEditActions({
  activeTabId,
  binaryBytes,
  clearPendingWork,
  compactOutput,
  currentValueRef,
  rtonDocument,
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
  setRtonDocument,
  setSearchState,
  setSourceBytes,
  setStats,
  setSurfaceNote,
  t,
  updateStatus,
  viewModeRef,
  replaceRtonDocumentBytes,
}: {
  activeTabId: number | null;
  binaryBytes: Uint8Array | null;
  clearPendingWork: () => void;
  compactOutput: boolean;
  currentValueRef: { current: RtonValue | null };
  rtonDocument: RtonDocumentRef | null;
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
  setRtonDocument: (document: RtonDocumentRef | null) => void;
  setSearchState: (state: SearchState) => void;
  setSourceBytes: (bytes: Uint8Array | null) => void;
  setStats: (stats: Stats) => void;
  setSurfaceNote: (note: string) => void;
  t: Translator;
  updateStatus: (message: string, tone?: Tone) => void;
  viewModeRef: { current: ViewMode };
  replaceRtonDocumentBytes: (documentId: number, bytes: Uint8Array) => Promise<RtonDocumentByteUpdateOutput>;
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

      if (rtonDocument && !currentValueRef.current) {
        updateStatus(t('status.parsingHexInWorker'), 'warn');
        void replaceRtonDocumentBytes(rtonDocument.id, new Uint8Array(nextBytes))
          .then(({ document, encrypted, compact, plainBytes, stats }) => {
            setBinaryBytes(plainBytes);
            setSourceBytes(plainBytes);
            setCurrentValueState(null);
            setRtonDocument(document);
            setParsedJson(null);
            setParseError(null);
            setStats(stats);
            setBinaryEncoding({ compact, encrypted: false });
            setSearchState({ kind: 'idle' });
            setSurfaceNote(t('format.largeDocumentMode'));
            updateStatus(t('status.rtonUpdated', { prefix: encrypted ? `${t('toolbar.encrypted')} ` : '' }), 'ok');
          })
          .catch((error: unknown) => {
            const message = errorMessage(error);
            invalidateFormatWork();
            setCurrentValueState(null);
            setRtonDocument(null);
            setParsedJson(null);
            setParseError(message);
            setStats(emptyStats());
            setBinaryEncoding(null);
            setSearchState({ kind: 'message', message });
            setSurfaceNote(t('format.rtonParseUnavailable'));
            updateStatus(t('status.rtonUpdateFailed', { message }), 'error');
          });
        return;
      }

      try {
        const { value, encrypted, compact, plainBytes } = decodeRtonSourceValue(nextBytes);
        setBinaryBytes(plainBytes);
        setSourceBytes(plainBytes);
        setCurrentValueState(value);
        setRtonDocument(null);
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
      currentValueRef,
      invalidateFormatWork,
      replaceRtonDocumentBytes,
      renderTextForValue,
      rtonDocument,
      setBinaryBytes,
      setBinaryEncoding,
      setCurrentValueState,
      setLastOutputBytes,
      setParseError,
      setParsedJson,
      setRtonDocument,
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
