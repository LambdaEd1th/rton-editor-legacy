import { useCallback, useEffect, useRef } from 'react';
import type { Translator } from '../localization/i18n';
import { emptyStats, type Stats } from '../domain/rton-value-analysis';
import {
  type EditorSurface,
  type JsonValue,
  type Tone,
  type ViewMode,
} from '../domain/rton-codec';
import type { RtonValue } from '../domain/rton-value';
import type { SearchState } from '../domain/rton-value-editing';
import {
  useFormatWorkerClient,
  type ActiveFormatRequest,
  type FormatWorkerResponse,
} from './worker-clients';

export function useTextFormatFlow({
  activeTabId,
  cancelSearch,
  currentValueRef,
  debounceMs,
  editorSurface,
  parseError,
  setCurrentValueState,
  setEditorSurface,
  setEditorTextState,
  setLastOutputBytes,
  setParseError,
  setParsedJson,
  setSearchState,
  setStats,
  setSurfaceNote,
  setViewModeState,
  t,
  timeoutMs,
  updateStatus,
  viewModeRef,
  wasmReady,
}: {
  activeTabId: number | null;
  cancelSearch: () => void;
  currentValueRef: { current: RtonValue | null };
  debounceMs: number;
  editorSurface: EditorSurface;
  parseError: string | null;
  setCurrentValueState: (value: RtonValue | null) => void;
  setEditorSurface: (surface: EditorSurface) => void;
  setEditorTextState: (text: string) => void;
  setLastOutputBytes: (bytes: number | null) => void;
  setParseError: (message: string | null) => void;
  setParsedJson: (value: JsonValue | null) => void;
  setSearchState: (state: SearchState) => void;
  setStats: (stats: Stats) => void;
  setSurfaceNote: (note: string) => void;
  setViewModeState: (mode: ViewMode) => void;
  t: Translator;
  timeoutMs: number;
  updateStatus: (message: string, tone?: Tone) => void;
  viewModeRef: { current: ViewMode };
  wasmReady: boolean;
}) {
  const parseTimer = useRef<number | null>(null);

  const clearParseTimer = useCallback(() => {
    if (parseTimer.current !== null) {
      window.clearTimeout(parseTimer.current);
      parseTimer.current = null;
    }
  }, []);

  const handleFormatWorkerResponse = useCallback(
    (response: FormatWorkerResponse) => {
      const label = response.mode.toUpperCase();
      if (response.ok && response.action === 'format') {
        setEditorTextState(response.text);
        setSurfaceNote(response.truncated ? t('format.previewTruncated', { label }) : t('format.editable', { label }));
        updateStatus(response.truncated ? t('format.generatedTruncated', { label }) : t('format.generated', { label }), response.truncated ? 'warn' : 'ok');
      } else if (response.ok && response.action === 'parse') {
        setCurrentValueState(response.value);
        setParsedJson(null);
        setParseError(null);
        setStats(response.stats);
        setSearchState({ kind: 'idle' });
        setSurfaceNote(t('format.editable', { label }));
        updateStatus(t('format.parsed', { label }), 'ok');
      } else if (!response.ok && response.action === 'format') {
        setEditorTextState(t('format.previewUnavailableText', { label, message: response.error }));
        setSurfaceNote(t('format.previewUnavailable', { label }));
        updateStatus(t('format.previewFailed', { label, message: response.error }), 'error');
      } else if (!response.ok && response.action === 'parse') {
        const message = t('format.parseFailed', { label, message: response.error });
        setCurrentValueState(null);
        setParsedJson(null);
        setParseError(message);
        setStats(emptyStats());
        setSearchState({ kind: 'message', message });
        setSurfaceNote(message);
        updateStatus(message, 'error');
      }
    },
    [setCurrentValueState, setEditorTextState, setParseError, setParsedJson, setSearchState, setStats, setSurfaceNote, t, updateStatus],
  );

  const handleFormatWorkerFailure = useCallback(
    (message: string, request: ActiveFormatRequest | null) => {
      if (!request) {
        updateStatus(message, 'error');
        return;
      }

      const label = request.mode.toUpperCase();
      if (request.action === 'format') {
        setEditorTextState(t('format.previewUnavailableText', { label, message }));
        setSurfaceNote(t('format.previewUnavailable', { label }));
        updateStatus(t('format.previewFailed', { label, message }), 'error');
      } else {
        const parseMessage = t('format.parseFailed', { label, message });
        setParseError(parseMessage);
        setStats(emptyStats());
        setSearchState({ kind: 'message', message: parseMessage });
        setSurfaceNote(parseMessage);
        updateStatus(parseMessage, 'error');
      }
    },
    [setEditorTextState, setParseError, setSearchState, setStats, setSurfaceNote, t, updateStatus],
  );

  const {
    beginFormatWorkerRequest,
    invalidateFormatWork,
    postFormatWorkerMessage,
    scheduleFormatWorkerTimeout,
  } = useFormatWorkerClient({
    t,
    viewModeRef,
    timeoutMs,
    onResponse: handleFormatWorkerResponse,
    onFailure: handleFormatWorkerFailure,
  });

  const parseJsonText = useCallback(
    (jsonText: string, options: { updateEditor?: boolean; statusMessage?: string } = {}) => {
      clearParseTimer();
      cancelSearch();

      if (!wasmReady) {
        updateStatus(t('status.wasmStillLoading'), 'warn');
        return;
      }

      const mode = 'json';
      const requestId = beginFormatWorkerRequest('parse', mode);
      scheduleFormatWorkerTimeout(requestId, mode, 'parse');
      postFormatWorkerMessage({
        action: 'parse',
        id: requestId,
        mode,
        text: jsonText,
      });
      if (options.updateEditor || viewModeRef.current === 'json') {
        setEditorTextState(jsonText);
        setSurfaceNote(t('format.editable', { label: viewModeRef.current.toUpperCase() }));
      }
      if (options.statusMessage) {
        updateStatus(options.statusMessage, 'ok');
      }
    },
    [
      beginFormatWorkerRequest,
      cancelSearch,
      clearParseTimer,
      setEditorTextState,
      setSurfaceNote,
      postFormatWorkerMessage,
      scheduleFormatWorkerTimeout,
      t,
      updateStatus,
      viewModeRef,
      wasmReady,
    ],
  );

  const renderTextForValue = useCallback(
    (value: RtonValue, mode: ViewMode) => {
      const requestId = beginFormatWorkerRequest('format', mode);
      const label = mode.toUpperCase();
      setSurfaceNote(t('format.generatingPreview', { label }));
      setEditorTextState(t('format.generatingPreviewText', { label }));
      scheduleFormatWorkerTimeout(requestId, mode, 'format');
      postFormatWorkerMessage({
        action: 'format',
        id: requestId,
        value,
        mode,
      });
      return true;
    },
    [beginFormatWorkerRequest, postFormatWorkerMessage, scheduleFormatWorkerTimeout, setEditorTextState, setSurfaceNote, t],
  );

  const renderAlternateFormat = useCallback(
    (mode: Exclude<ViewMode, 'json'>) => {
      const label = mode.toUpperCase();
      setSurfaceNote(t('format.generatingPreview', { label }));

      if (parseError) {
        invalidateFormatWork();
        setEditorTextState(t('format.unparseablePreview', { label, message: parseError }));
        setSurfaceNote(t('format.previewUnavailable', { label }));
        return;
      }

      const value = currentValueRef.current;
      if (!value) {
        invalidateFormatWork();
        setEditorTextState(t('format.noValuePreview', { label }));
        setSurfaceNote(t('format.previewUnavailable', { label }));
        return;
      }

      const requestId = beginFormatWorkerRequest('format', mode);
      setEditorTextState(t('format.generatingPreviewText', { label }));
      scheduleFormatWorkerTimeout(requestId, mode, 'format');
      postFormatWorkerMessage({
        action: 'format',
        id: requestId,
        value,
        mode,
      });
    },
    [
      beginFormatWorkerRequest,
      currentValueRef,
      invalidateFormatWork,
      parseError,
      postFormatWorkerMessage,
      scheduleFormatWorkerTimeout,
      setEditorTextState,
      setSurfaceNote,
      t,
    ],
  );

  const parseAlternateFormat = useCallback(
    (mode: Exclude<ViewMode, 'json'>, text: string) => {
      clearParseTimer();
      const requestId = beginFormatWorkerRequest('parse', mode);
      const label = mode.toUpperCase();
      setSurfaceNote(t('format.parsing', { label }));
      scheduleFormatWorkerTimeout(requestId, mode, 'parse');
      postFormatWorkerMessage({
        action: 'parse',
        id: requestId,
        mode,
        text,
      });
    },
    [beginFormatWorkerRequest, clearParseTimer, postFormatWorkerMessage, scheduleFormatWorkerTimeout, setSurfaceNote, t],
  );

  const scheduleEditorParse = useCallback(
    (mode: ViewMode, text: string) => {
      clearParseTimer();
      cancelSearch();
      setLastOutputBytes(null);
      if (mode === 'json') {
        setSearchState({ kind: 'message', message: t('format.waitJsonParse') });
        parseTimer.current = window.setTimeout(() => {
          parseJsonText(text);
        }, debounceMs);
      } else {
        const label = mode.toUpperCase();
        setSearchState({ kind: 'message', message: t('format.waitParse', { label }) });
        setSurfaceNote(t('format.editing', { label }));
        parseTimer.current = window.setTimeout(() => {
          parseAlternateFormat(mode, text);
        }, debounceMs);
      }
    },
    [cancelSearch, clearParseTimer, debounceMs, parseAlternateFormat, parseJsonText, setLastOutputBytes, setSearchState, setSurfaceNote, t],
  );

  const setViewMode = useCallback(
    (mode: ViewMode) => {
      if (activeTabId === null) {
        updateStatus(t('status.openFileFirst'), 'warn');
        return;
      }

      if (mode === viewModeRef.current) {
        setEditorSurface('text');
        if (editorSurface === 'hex') {
          const value = currentValueRef.current;
          if (value) {
            renderTextForValue(value, mode);
          }
        }
        return;
      }

      viewModeRef.current = mode;
      setViewModeState(mode);
      setEditorSurface('text');
      invalidateFormatWork();

      if (mode === 'json') {
        const value = currentValueRef.current;
        if (!value) {
          updateStatus(parseError ? t('format.jsonCannotConvert', { message: parseError }) : t('status.noSearchableValue'), 'error');
          setSurfaceNote(t('format.jsonPreviewUnavailable'));
          return;
        }

        renderTextForValue(value, mode);
      } else {
        renderAlternateFormat(mode);
      }
    },
    [
      activeTabId,
      currentValueRef,
      editorSurface,
      invalidateFormatWork,
      parseError,
      renderAlternateFormat,
      renderTextForValue,
      setEditorSurface,
      setSurfaceNote,
      setViewModeState,
      t,
      updateStatus,
      viewModeRef,
    ],
  );

  useEffect(() => {
    return () => {
      clearParseTimer();
    };
  }, [clearParseTimer]);

  return {
    clearParseTimer,
    invalidateFormatWork,
    renderTextForValue,
    scheduleEditorParse,
    setViewMode,
  };
}
