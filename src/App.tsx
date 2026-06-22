import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
} from 'react';
import init from './wasm/rton-editor/rton_editor_wasm';
import { AppToolbar } from './components/AppToolbar';
import type { EditorJumpTarget } from './components/CodeEditor';
import { EditorStage } from './components/EditorStage';
import { EditorTabStrip, type TabDropPlacement } from './components/EditorTabStrip';
import type { HexEditorJumpTarget } from './components/HexEditor';
import { AppStatusBar } from './components/AppStatusBar';
import { FileListPanel } from './components/FileListPanel';
import { RightInspectorPanel } from './components/RightInspectorPanel';
import { PanelResizeHandle, type PanelSide } from './components/Panels';
import type { StructuredFormatMode } from './format-conversion';
import { useI18n } from './localization/use-i18n';
import {
  type RtonValue,
} from './rton-value';
import { sampleJson } from './sample';
import { locateRtonValueOffset } from './rton-offset-map';
import { runActiveEditorShortcut, type EditorShortcutKind } from './components/keyboard-shortcuts';
import type { RtonInlineSelectOption } from './components/RtonInlineSelect';
import {
  replaceRtonValueAtPath,
  type RtonValuePath,
  type SearchState,
} from './rton-value-editing';
import { locateRtonPathInText } from './rton-text-locator';
import { collectStats, emptyStats, runChunkedSearch } from './rton-value-analysis';
import {
  collectDirectoryEntries,
  collectDroppedEntries,
  collectLoadableCandidates,
  displayFilePath,
  LOADABLE_FILE_HINT,
  normalizeDisplayPath,
  type DirectoryPickerWindow,
  type RtonLoadEntry,
} from './file-loading';
import {
  downloadBlob,
  downloadBytes,
  formatBytes,
  outputBaseName,
  timestampForFileName,
} from './file-export';
import {
  createBatchExportArchive,
  encodeBatchExportValue,
  resolveBatchExportItemValue,
  type BatchExportMode,
} from './batch-export';
import {
  decodeLoadableSource,
  decodeRtonSourceValue,
  encodeRtonOutputBytes,
  formatRtonEncoding,
  isEncryptedRtonBytes,
  isPendingTextPreview,
  parseJsonTextToRtonValue,
  rtonValueToJsonText,
  rtonValueToJsonValue,
  sameRtonEncoding,
  type EditorSurface,
  type JsonValue,
  type RtonBinaryEncoding,
  type StatusState,
  type Tone,
  type ViewMode,
} from './rton-codec';
import { createEditorTabFromValue, type EditorTab } from './editor-tabs';
import {
  appendEditorTabs,
  closeEditorTabState,
  createActiveEditorTabSnapshot,
  findEditorTab,
  moveEditorTabState,
  syncActiveEditorTab,
  unlinkLoadedFileTab,
} from './editor-workspace';
import {
  applyThemePreference,
  readLineWrappingPreference,
  readThemePreference,
  saveLineWrappingPreference,
  saveThemePreference,
  SYSTEM_DARK_QUERY,
  type ThemePreference,
} from './preferences';
import {
  buildLoadedFileItems,
  filterLoadedFileItems,
  type LoadedRtonFile,
} from './loaded-file-items';
import {
  clampPanelWidth,
  LEFT_PANEL_DEFAULT_WIDTH,
  RIGHT_PANEL_DEFAULT_WIDTH,
} from './panel-layout';
import { cx } from './ui-classes';
import {
  useByteTransformWorker,
  useFormatWorkerClient,
  type ActiveFormatRequest,
  type FormatWorkerResponse,
} from './worker-clients';

const SEARCH_DEBOUNCE_MS = 140;
const EDITOR_PARSE_DEBOUNCE_MS = 450;
const FORMAT_WORKER_TIMEOUT_MS = 20_000;

if (typeof window !== 'undefined' && typeof document !== 'undefined') {
  applyThemePreference(readThemePreference());
}

export function App() {
  const { lang, langs, getLangLabel, setLang, t } = useI18n();
  const [tabs, setTabs] = useState<EditorTab[]>([]);
  const [loadedFiles, setLoadedFiles] = useState<LoadedRtonFile[]>([]);
  const [selectedFileKeys, setSelectedFileKeys] = useState<Set<string>>(() => new Set());
  const [activeTabId, setActiveTabId] = useState<number | null>(null);
  const [wasmReady, setWasmReady] = useState(false);
  const [fileName, setFileName] = useState('');
  const [sourceBytes, setSourceBytes] = useState<Uint8Array | null>(null);
  const [binaryBytes, setBinaryBytes] = useState<Uint8Array | null>(null);
  const [binaryEncoding, setBinaryEncoding] = useState<RtonBinaryEncoding | null>(null);
  const [currentValue, setCurrentValue] = useState<RtonValue | null>(null);
  const [editorText, setEditorTextState] = useState('');
  const [editorJumpTarget, setEditorJumpTarget] = useState<EditorJumpTarget | null>(null);
  const [hexJumpTarget, setHexJumpTarget] = useState<HexEditorJumpTarget | null>(null);
  const [lastOutputBytes, setLastOutputBytes] = useState<number | null>(null);
  const [compactOutput, setCompactOutput] = useState(false);
  const [encryptOutput, setEncryptOutput] = useState(false);
  const [parsedJson, setParsedJson] = useState<JsonValue | null>(null);
  const [parseError, setParseError] = useState<string | null>(null);
  const [stats, setStats] = useState(() => emptyStats());
  const [viewMode, setViewModeState] = useState<ViewMode>('json');
  const [editorSurface, setEditorSurface] = useState<EditorSurface>('text');
  const [surfaceNote, setSurfaceNote] = useState(() => t('app.waitingFile'));
  const [status, setStatus] = useState<StatusState>(() => ({ message: t('status.wasmInitializing'), tone: 'warn' }));
  const [fileSearchQuery, setFileSearchQuery] = useState('');
  const [searchQuery, setSearchQuery] = useState('');
  const [searchState, setSearchState] = useState<SearchState>(() => ({ kind: 'message', message: t('app.emptyFile') }));
  const [dragging, setDragging] = useState(false);
  const [leftPanelWidth, setLeftPanelWidth] = useState(LEFT_PANEL_DEFAULT_WIDTH);
  const [rightPanelWidth, setRightPanelWidth] = useState(RIGHT_PANEL_DEFAULT_WIDTH);
  const [themePreference, setThemePreference] = useState<ThemePreference>(() => readThemePreference());
  const [lineWrapping, setLineWrapping] = useState(() => readLineWrappingPreference());
  const [editorSearchPanelVisible, setEditorSearchPanelVisible] = useState(false);

  const nextTabId = useRef(1);
  const nextLoadedFileId = useRef(1);
  const nextEditorJumpId = useRef(1);
  const nextHexJumpId = useRef(1);
  const currentValueRef = useRef<RtonValue | null>(currentValue);
  const viewModeRef = useRef<ViewMode>(viewMode);
  const parseTimer = useRef<number | null>(null);
  const searchTimer = useRef<number | null>(null);
  const activeSearchId = useRef(0);
  const themeOptions = useMemo<Array<RtonInlineSelectOption<ThemePreference>>>(
    () => [
      { value: 'system', label: t('theme.system') },
      { value: 'light', label: t('theme.light') },
      { value: 'dark', label: t('theme.dark') },
    ],
    [lang, t],
  );
  const languageOptions = useMemo<Array<RtonInlineSelectOption<string>>>(
    () => langs.map((value) => ({ value, label: getLangLabel(value) })),
    [getLangLabel, lang, langs],
  );

  const setCurrentValueState = useCallback((value: RtonValue | null) => {
    currentValueRef.current = value;
    setCurrentValue(value);
  }, []);

  const updateStatus = useCallback((message: string, tone: Tone = 'warn') => {
    setStatus({ message, tone });
  }, []);

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
        const plainValue = response.plainValue as JsonValue;
        setCurrentValueState(response.value);
        setParsedJson(plainValue);
        setParseError(null);
        setStats(collectStats(response.value));
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
        setParseError(message);
        setSearchState({ kind: 'message', message });
        setSurfaceNote(message);
        updateStatus(message, 'error');
      }
    },
    [setCurrentValueState, t, updateStatus],
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
        setSearchState({ kind: 'message', message: parseMessage });
        setSurfaceNote(parseMessage);
        updateStatus(parseMessage, 'error');
      }
    },
    [t, updateStatus],
  );

  const {
    beginFormatWorkerRequest,
    invalidateFormatWork,
    postFormatWorkerMessage,
    scheduleFormatWorkerTimeout,
  } = useFormatWorkerClient({
    t,
    viewModeRef,
    timeoutMs: FORMAT_WORKER_TIMEOUT_MS,
    onResponse: handleFormatWorkerResponse,
    onFailure: handleFormatWorkerFailure,
  });

  const { runByteTransformInWorker } = useByteTransformWorker({
    t,
    onError: (message) => updateStatus(message, 'error'),
  });

  const clearPendingWork = useCallback(() => {
    clearParseTimer();
    if (searchTimer.current !== null) {
      window.clearTimeout(searchTimer.current);
      searchTimer.current = null;
    }
    activeSearchId.current += 1;
    invalidateFormatWork();
  }, [clearParseTimer, invalidateFormatWork]);

  const snapshotActiveTab = useCallback(
    () =>
      createActiveEditorTabSnapshot({
        activeTabId,
        fileName,
        sourceBytes,
        binaryBytes,
        binaryEncoding,
        currentValue: currentValueRef.current,
        editorText,
        lastOutputBytes,
        parsedJson,
        parseError,
        stats,
        viewMode,
        editorSurface,
        surfaceNote,
        searchQuery,
        searchState,
        status,
      }),
    [
      activeTabId,
      binaryBytes,
      binaryEncoding,
      editorText,
      editorSurface,
      fileName,
      lastOutputBytes,
      parseError,
      parsedJson,
      searchQuery,
      searchState,
      sourceBytes,
      stats,
      status,
      surfaceNote,
      viewMode,
    ],
  );

  const restoreEmptyWorkspace = useCallback(
    (nextStatus: StatusState) => {
      clearPendingWork();
      viewModeRef.current = 'json';

      setActiveTabId(null);
      setFileName('');
      setSourceBytes(null);
      setBinaryBytes(null);
      setBinaryEncoding(null);
      setCurrentValueState(null);
      setEditorTextState('');
      setEditorJumpTarget(null);
      setHexJumpTarget(null);
      setLastOutputBytes(null);
      setParsedJson(null);
      setParseError(null);
      setStats(emptyStats());
      setViewModeState('json');
      setEditorSurface('text');
      setSurfaceNote(t('app.waitingFile'));
      setSearchQuery('');
      setSearchState({ kind: 'message', message: t('app.emptyFile') });
      setEditorSearchPanelVisible(false);
      setStatus(nextStatus);
    },
    [clearPendingWork, setCurrentValueState, t],
  );

  const restoreEditorTab = useCallback(
    (tab: EditorTab) => {
      clearPendingWork();
      viewModeRef.current = tab.viewMode;

      setActiveTabId(tab.id);
      setFileName(tab.fileName);
      setSourceBytes(tab.sourceBytes);
      setBinaryBytes(tab.binaryBytes);
      setBinaryEncoding(tab.binaryEncoding);
      setCurrentValueState(tab.currentValue);
      setEditorTextState(tab.editorText);
      setEditorJumpTarget(null);
      setHexJumpTarget(null);
      setLastOutputBytes(tab.lastOutputBytes);
      setParsedJson(tab.parsedJson);
      setParseError(tab.parseError);
      setStats(tab.stats);
      setViewModeState(tab.viewMode);
      setEditorSurface(tab.editorSurface);
      setSurfaceNote(tab.surfaceNote);
      setSearchQuery(tab.searchQuery);
      setSearchState(tab.searchState);
      setStatus(tab.status);
    },
    [clearPendingWork, setCurrentValueState],
  );

  const syncActiveTab = useCallback(
    (nextTabs: EditorTab[] = tabs) => {
      return syncActiveEditorTab(nextTabs, snapshotActiveTab());
    },
    [snapshotActiveTab, tabs],
  );

  const openEditorTabs = useCallback(
    (newTabs: EditorTab[]) => {
      if (newTabs.length === 0) {
        return;
      }

      const { nextActive, nextTabs } = appendEditorTabs(tabs, newTabs, snapshotActiveTab());
      if (!nextActive) {
        return;
      }

      setTabs(nextTabs);
      restoreEditorTab(nextActive);
    },
    [restoreEditorTab, snapshotActiveTab, tabs],
  );

  const activateEditorTab = useCallback(
    (tabId: number) => {
      if (tabId === activeTabId) {
        return;
      }

      const syncedTabs = syncActiveTab();
      const target = findEditorTab(syncedTabs, tabId);
      if (!target) {
        return;
      }

      setTabs(syncedTabs);
      restoreEditorTab(target);
    },
    [activeTabId, restoreEditorTab, syncActiveTab],
  );

  const closeEditorTab = useCallback(
    (tabId: number) => {
      const syncedTabs = syncActiveTab();
      const result = closeEditorTabState(syncedTabs, tabId, activeTabId);
      if (!result.closed) {
        return;
      }

      setLoadedFiles((files) => unlinkLoadedFileTab(files, tabId));

      if (result.nextTabs.length === 0) {
        setTabs([]);
        restoreEmptyWorkspace({ message: t('status.noOpenFiles'), tone: 'warn' });
        return;
      }

      setTabs(result.nextTabs);
      if (result.nextActive) {
        restoreEditorTab(result.nextActive);
      }
    },
    [activeTabId, restoreEditorTab, restoreEmptyWorkspace, syncActiveTab, t],
  );

  const moveEditorTab = useCallback(
    (tabId: number, targetTabId: number, placement: TabDropPlacement) => {
      if (tabId === targetTabId || tabs.length < 2) {
        return;
      }
      setTabs(moveEditorTabState(syncActiveTab(), tabId, targetTabId, placement));
    },
    [syncActiveTab, tabs.length],
  );

  const parseJsonText = useCallback(
    (jsonText: string, options: { updateEditor?: boolean; statusMessage?: string } = {}) => {
      clearParseTimer();
      activeSearchId.current += 1;

      if (!wasmReady) {
        updateStatus(t('status.wasmStillLoading'), 'warn');
        return;
      }

      try {
        const value = parseJsonTextToRtonValue(jsonText);
        const plainValue = rtonValueToJsonValue(value);
        setCurrentValueState(value);
        setParsedJson(plainValue);
        setParseError(null);
        setStats(collectStats(value));
        if (options.updateEditor || viewModeRef.current === 'json') {
          setEditorTextState(jsonText);
          setSurfaceNote(t('format.editable', { label: viewModeRef.current.toUpperCase() }));
        }
        if (options.statusMessage) {
          updateStatus(options.statusMessage, 'ok');
        }
      } catch (error) {
        const message = errorMessage(error);
        setCurrentValueState(null);
        setParsedJson(null);
        setParseError(message);
        setStats(emptyStats());
        setSearchState({ kind: 'message', message });
        updateStatus(message, 'error');
      }
    },
    [clearParseTimer, setCurrentValueState, t, updateStatus, wasmReady],
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
	    [beginFormatWorkerRequest, postFormatWorkerMessage, scheduleFormatWorkerTimeout, t],
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
	    [beginFormatWorkerRequest, invalidateFormatWork, parseError, postFormatWorkerMessage, scheduleFormatWorkerTimeout, t],
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
	    [beginFormatWorkerRequest, clearParseTimer, postFormatWorkerMessage, scheduleFormatWorkerTimeout, t],
	  );

  const scheduleEditorParse = useCallback(
    (mode: ViewMode, text: string) => {
      clearParseTimer();
      activeSearchId.current += 1;
      setLastOutputBytes(null);
      if (mode === 'json') {
        setSearchState({ kind: 'message', message: t('format.waitJsonParse') });
        parseTimer.current = window.setTimeout(() => {
          parseJsonText(text);
        }, EDITOR_PARSE_DEBOUNCE_MS);
      } else {
        const label = mode.toUpperCase();
        setSearchState({ kind: 'message', message: t('format.waitParse', { label }) });
        setSurfaceNote(t('format.editing', { label }));
        parseTimer.current = window.setTimeout(() => {
          parseAlternateFormat(mode, text);
        }, EDITOR_PARSE_DEBOUNCE_MS);
      }
    },
    [clearParseTimer, parseAlternateFormat, parseJsonText, t],
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
			    [activeTabId, editorSurface, invalidateFormatWork, parseError, renderAlternateFormat, renderTextForValue, t, updateStatus],
			  );

  const hasActiveFile = activeTabId !== null && tabs.length > 0;
  const displayFileName = hasActiveFile ? fileName : t('app.emptyFile');
  const targetBinaryEncoding = useMemo<RtonBinaryEncoding>(
    () => ({ compact: compactOutput, encrypted: encryptOutput }),
    [compactOutput, encryptOutput],
  );
  const hexOutputMatchesSource = binaryEncoding !== null && sameRtonEncoding(binaryEncoding, targetBinaryEncoding);
  const displayedHexBytes = binaryBytes;
  const outputText = hasActiveFile
    ? editorSurface === 'hex' && binaryBytes
      ? `${formatBytes(binaryBytes.byteLength)} · ${t('app.rawBytes')}`
      : lastOutputBytes
        ? `${formatBytes(lastOutputBytes)} · ${compactOutput ? 'compact' : 'standard'}${encryptOutput ? ' · encrypted' : ''}`
        : t('app.notGenerated')
    : t('app.noOutput');
  const displaySurfaceNote =
    editorSurface === 'hex'
      ? binaryBytes
        ? `RTON · ${formatBytes(binaryBytes.byteLength)}`
        : t('app.rtonUnavailable')
      : surfaceNote;

	  const validateValue = useCallback(() => {
    if (activeTabId === null) {
      updateStatus(t('status.openFileFirst'), 'warn');
      return;
    }

    if (!wasmReady) {
      updateStatus(t('status.wasmStillLoading'), 'warn');
      return;
    }

    try {
      if (editorSurface === 'hex' && binaryBytes) {
        setLastOutputBytes(hexOutputMatchesSource ? binaryBytes.byteLength : null);
        updateStatus(t('format.exportable', { label: `${formatRtonEncoding(targetBinaryEncoding, t)} RTON` }), 'ok');
        return;
      }

      const value = currentValueRef.current;
      if (!value) {
        throw new Error(parseError ?? t('status.noSearchableValue'));
      }
      setLastOutputBytes(null);
      updateStatus(t('format.exportable', { label: viewModeRef.current.toUpperCase() }), 'ok');
    } catch (error) {
      updateStatus(errorMessage(error), 'error');
    }
	  }, [
	    activeTabId,
	    binaryBytes,
		    editorSurface,
		    hexOutputMatchesSource,
		    parseError,
	    t,
	    targetBinaryEncoding,
	    updateStatus,
	    wasmReady,
	  ]);

  const refreshOutputBytesForOptions = useCallback(() => {
    setLastOutputBytes(null);
  }, []);

  useEffect(() => {
    viewModeRef.current = viewMode;
  }, [viewMode]);

  useEffect(() => {
    applyThemePreference(themePreference);
    saveThemePreference(themePreference);

    const media = window.matchMedia(SYSTEM_DARK_QUERY);
    const handleSystemThemeChange = () => {
      if (themePreference === 'system') {
        applyThemePreference(themePreference);
      }
    };

    media.addEventListener('change', handleSystemThemeChange);
    return () => media.removeEventListener('change', handleSystemThemeChange);
  }, [themePreference]);

  useEffect(() => {
    saveLineWrappingPreference(lineWrapping);
  }, [lineWrapping]);

  useEffect(() => {
    if (editorSurface === 'hex' && !binaryBytes) {
      setEditorSurface('text');
    }
  }, [binaryBytes, editorSurface]);

  useEffect(() => {
    currentValueRef.current = currentValue;
  }, [currentValue]);

  useEffect(() => {
    if (activeTabId === null) {
      setCompactOutput(false);
      setEncryptOutput(false);
      return;
    }
	    if (binaryEncoding) {
	      setCompactOutput(binaryEncoding.compact);
	      setEncryptOutput(binaryEncoding.encrypted);
	      return;
	    }
	    setCompactOutput(false);
	    setEncryptOutput(false);
	  }, [activeTabId, binaryEncoding]);

  useEffect(() => {
    void init()
      .then(() => {
        setWasmReady(true);
        updateStatus(t('status.wasmReady'), 'ok');
      })
      .catch((error: unknown) => {
        updateStatus(errorMessage(error), 'error');
      });

    return () => {
      if (parseTimer.current !== null) {
        window.clearTimeout(parseTimer.current);
      }
      if (searchTimer.current !== null) {
        window.clearTimeout(searchTimer.current);
      }
    };
  }, [t, updateStatus]);

  useEffect(() => {
    if (wasmReady && activeTabId !== null) {
      validateValue();
    }
  }, [activeTabId, validateValue, wasmReady]);

  useEffect(() => {
    if (searchTimer.current !== null) {
      window.clearTimeout(searchTimer.current);
    }
    activeSearchId.current += 1;

    if (activeTabId === null) {
      setSearchState({ kind: 'message', message: t('app.emptyFile') });
      return;
    }

    const query = searchQuery.trim().toLowerCase();
    if (parseError) {
      setSearchState({ kind: 'message', message: parseError });
      return;
    }

    if (!currentValue) {
      setSearchState({ kind: 'message', message: t('status.noSearchableValue') });
      return;
    }

    if (!query) {
      setSearchState({ kind: 'idle' });
      return;
    }

    setSearchState({ kind: 'message', message: t('status.searching', { query }) });
    const searchId = activeSearchId.current + 1;
    activeSearchId.current = searchId;
    searchTimer.current = window.setTimeout(() => {
      runChunkedSearch(currentValue, query, searchId, activeSearchId, setSearchState);
    }, SEARCH_DEBOUNCE_MS);
  }, [activeTabId, currentValue, parseError, searchQuery, t]);

	  const loadedFileItems = useMemo(
    () => buildLoadedFileItems({ files: loadedFiles, tabs, activeTabId, fileName, sourceBytes, viewMode, editorSurface, t }),
    [activeTabId, editorSurface, fileName, lang, loadedFiles, sourceBytes, tabs, viewMode, t],
  );
  const filteredLoadedFileItems = useMemo(
    () => filterLoadedFileItems(loadedFileItems, fileSearchQuery),
    [fileSearchQuery, loadedFileItems],
  );
  const fileSearchActive = fileSearchQuery.trim().length > 0;
  const listedFileCount = loadedFileItems.length;
  const visibleFileCount = filteredLoadedFileItems.length;
  const selectedFileCount = selectedFileKeys.size;
  const selectedVisibleFileCount = filteredLoadedFileItems.reduce(
    (count, item) => count + (selectedFileKeys.has(item.key) ? 1 : 0),
    0,
  );
  const fileListSubtitle = fileSearchActive
    ? t('fileList.matchCount', {
        visible: visibleFileCount.toLocaleString(),
        total: listedFileCount.toLocaleString(),
        selected: selectedFileCount.toLocaleString(),
      })
    : t('fileList.selectedCount', {
        selected: selectedFileCount.toLocaleString(),
        total: listedFileCount.toLocaleString(),
      });
  const workspaceStyle = {
    '--rton-left-panel-width': `${leftPanelWidth}px`,
    '--rton-right-panel-width': `${rightPanelWidth}px`,
  } as CSSProperties;

  const resizePanel = useCallback((side: PanelSide, width: number) => {
    const clamped = clampPanelWidth(width);
    if (side === 'left') {
      setLeftPanelWidth(clamped);
    } else {
      setRightPanelWidth(clamped);
    }
  }, []);

  useEffect(() => {
    const availableKeys = new Set(loadedFileItems.map((item) => item.key));
    setSelectedFileKeys((current) => {
      const next = new Set([...current].filter((key) => availableKeys.has(key)));
      return next.size === current.size ? current : next;
    });
  }, [loadedFileItems]);

  const selectAllListedFiles = useCallback(() => {
    setSelectedFileKeys((current) => {
      const next = new Set(current);
      filteredLoadedFileItems.forEach((item) => next.add(item.key));
      return next;
    });
  }, [filteredLoadedFileItems]);

  const clearSelectedFiles = useCallback(() => {
    setSelectedFileKeys((current) => {
      const next = new Set(current);
      filteredLoadedFileItems.forEach((item) => next.delete(item.key));
      return next;
    });
  }, [filteredLoadedFileItems]);

  const toggleSelectedFile = useCallback((key: string, selected: boolean) => {
    setSelectedFileKeys((current) => {
      const next = new Set(current);
      if (selected) {
        next.add(key);
      } else {
        next.delete(key);
      }
      return next;
    });
  }, []);

  const toggleSelectedFiles = useCallback((keys: string[], selected: boolean) => {
    setSelectedFileKeys((current) => {
      const next = new Set(current);
      keys.forEach((key) => {
        if (selected) {
          next.add(key);
        } else {
          next.delete(key);
        }
      });
      return next;
    });
  }, []);

	  const onEditorInput = (value: string) => {
	    if (activeTabId === null) {
	      return;
	    }
	
	    setBinaryBytes(null);
	    setBinaryEncoding(null);
	    setEditorTextState(value);
	    scheduleEditorParse(viewModeRef.current, value);
	  };

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
	      const bytes = encodeRtonOutputBytes(value, compactOutput, encryptOutput);
	      setBinaryBytes(bytes);
	      setBinaryEncoding({ compact: compactOutput, encrypted: encryptOutput });
      setSourceBytes(bytes);
      setLastOutputBytes(null);
      setEditorSurface('hex');
      setSurfaceNote(t('format.rtonEditable'));
      updateStatus(t('status.rtonBinaryGenerated'), 'ok');
    } catch (error) {
      updateStatus(errorMessage(error), 'error');
    }
  }, [activeTabId, binaryBytes, compactOutput, encryptOutput, parseError, t, updateStatus]);

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
	      const { value, encrypted, compact } = decodeRtonSourceValue(nextBytes);
	      setCurrentValueState(value);
	      setParsedJson(rtonValueToJsonValue(value));
	      setParseError(null);
	      setStats(collectStats(value));
	      setBinaryEncoding({ compact, encrypted });
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
	    [activeTabId, clearPendingWork, invalidateFormatWork, renderTextForValue, setCurrentValueState, t, updateStatus],
	  );

  const loadSample = () => {
    if (!wasmReady) {
      updateStatus(t('status.wasmStillLoading'), 'warn');
      return;
    }

    try {
      const value = parseJsonTextToRtonValue(sampleJson);
      const tab = createEditorTabFromValue({
        id: nextTabId.current,
        fileName: 'sample.json',
        value,
        editorText: rtonValueToJsonText(value, true),
        sourceBytes: null,
        status: { message: t('status.sampleLoaded'), tone: 'ok' },
      });
      nextTabId.current += 1;
      openEditorTabs([tab]);
    } catch (error) {
      updateStatus(errorMessage(error), 'error');
    }
  };

  const loadRtonEntries = async (entries: RtonLoadEntry[]) => {
    if (!wasmReady) {
      updateStatus(t('status.wasmStillLoading'), 'warn');
      return;
    }

    const candidates = collectLoadableCandidates(entries, true);
    const skipped = entries.length - candidates.length;
    if (candidates.length === 0) {
      updateStatus(t('status.noLoadableFiles', { hint: LOADABLE_FILE_HINT }), 'warn');
      return;
    }

    const loadedTabs: EditorTab[] = [];
    const errors: string[] = [];
    const preferredEditorSurface: EditorSurface = activeTabId === null ? 'hex' : editorSurface;
    for (const entry of candidates) {
      try {
        const decoded = await decodeLoadableSource(entry, viewModeRef.current, preferredEditorSurface, t);
        loadedTabs.push(
          createEditorTabFromValue({
            id: nextTabId.current,
            fileName: normalizeDisplayPath(entry.path),
            value: decoded.value,
            editorText: decoded.editorText,
	            surfaceNote: decoded.surfaceNote,
	            sourceBytes: decoded.sourceBytes,
	            binaryBytes: decoded.binaryBytes,
	            binaryEncoding: decoded.binaryEncoding,
	            viewMode: decoded.viewMode,
            editorSurface: decoded.editorSurface,
            status: decoded.status,
          }),
        );
        nextTabId.current += 1;
      } catch (error) {
        errors.push(`${normalizeDisplayPath(entry.path)}: ${errorMessage(error)}`);
      }
    }

	    if (loadedTabs.length > 0) {
	      openEditorTabs(loadedTabs);
	      const nextActive = loadedTabs[loadedTabs.length - 1];
	      if (nextActive.editorSurface === 'text' && nextActive.currentValue && isPendingTextPreview(nextActive.editorText)) {
	        window.setTimeout(() => renderTextForValue(nextActive.currentValue as RtonValue, nextActive.viewMode), 0);
	      }
	      const suffix = skipped > 0 ? t('status.skippedFiles', { count: skipped.toLocaleString() }) : '';
	      const message = loadedTabs.length === 1
          ? `${loadedTabs[0].status.message}${suffix}`
          : t('status.loadedFiles', { count: loadedTabs.length.toLocaleString(), suffix });
	      updateStatus(message, 'ok');
    }

    if (errors.length > 0) {
      updateStatus(errors.join('；'), 'error');
    }
  };

  const stageRtonEntries = useCallback(
    (entries: RtonLoadEntry[]) => {
      const candidates = collectLoadableCandidates(entries, false);
      const skipped = entries.length - candidates.length;
      if (candidates.length === 0) {
        updateStatus(t('status.noLoadableFiles', { hint: LOADABLE_FILE_HINT }), 'warn');
        return;
      }

      const nextFiles = candidates.map(({ file, kind, path }) => {
        const item: LoadedRtonFile = {
          id: nextLoadedFileId.current,
          file,
          kind,
          path: normalizeDisplayPath(path),
          tabId: null,
        };
        nextLoadedFileId.current += 1;
        return item;
      });

      setLoadedFiles(nextFiles);
      const suffix = skipped > 0 ? t('status.skippedFiles', { count: skipped.toLocaleString() }) : '';
      updateStatus(t('status.indexedFiles', { count: nextFiles.length.toLocaleString(), suffix }), 'ok');
    },
    [t, updateStatus],
  );

  const openLoadedFile = useCallback(
    async (fileId: number) => {
      const entry = loadedFiles.find((file) => file.id === fileId);
      if (!entry) {
        return;
      }

      if (entry.tabId !== null && tabs.some((tab) => tab.id === entry.tabId)) {
        activateEditorTab(entry.tabId);
        return;
      }

      if (!wasmReady) {
        updateStatus(t('status.wasmStillLoading'), 'warn');
        return;
      }

      try {
        updateStatus(t('status.parsingPath', { path: entry.path }), 'warn');
        const preferredEditorSurface: EditorSurface = activeTabId === null ? 'hex' : editorSurface;
        const decoded = await decodeLoadableSource(entry, viewModeRef.current, preferredEditorSurface, t);
        const tabId = nextTabId.current;
        const tab = createEditorTabFromValue({
          id: tabId,
          fileName: entry.path,
          value: decoded.value,
          editorText: decoded.editorText,
	          surfaceNote: decoded.surfaceNote,
	          sourceBytes: decoded.sourceBytes,
	          binaryBytes: decoded.binaryBytes,
	          binaryEncoding: decoded.binaryEncoding,
	          viewMode: decoded.viewMode,
          editorSurface: decoded.editorSurface,
          status: decoded.status,
        });
        nextTabId.current += 1;
	        setLoadedFiles((files) => files.map((file) => (file.id === fileId ? { ...file, tabId } : file)));
	        openEditorTabs([tab]);
	        if (tab.editorSurface === 'text' && tab.currentValue && isPendingTextPreview(tab.editorText)) {
	          window.setTimeout(() => renderTextForValue(tab.currentValue as RtonValue, tab.viewMode), 0);
	        }
	        updateStatus(decoded.status.message, decoded.status.tone);
	      } catch (error) {
        updateStatus(`${entry.path}: ${errorMessage(error)}`, 'error');
      }
    },
	    [activateEditorTab, activeTabId, editorSurface, loadedFiles, openEditorTabs, renderTextForValue, t, tabs, updateStatus, wasmReady],
	  );

  const loadRtonFiles = async (files: File[]) => {
    await loadRtonEntries(files.map((file) => ({ file, path: displayFilePath(file) })));
  };

  const loadRtonFolder = async () => {
    const picker = (window as DirectoryPickerWindow).showDirectoryPicker;
    if (!picker) {
      updateStatus(t('status.folderPickerSafari'), 'warn');
      return;
    }

    try {
      const directoryHandle = await picker.call(window);
      const entries = await collectDirectoryEntries(directoryHandle, normalizeDisplayPath(directoryHandle.name));
      stageRtonEntries(entries);
    } catch (error) {
      if (error instanceof DOMException && error.name === 'AbortError') {
        return;
      }
      if (isDirectoryPickerGestureError(error)) {
        updateStatus(t('status.folderPickerDenied'), 'warn');
        return;
      }
      updateStatus(errorMessage(error), 'error');
    }
  };

  const downloadRton = async () => {
    if (activeTabId === null) {
      updateStatus(t('status.openFileFirst'), 'warn');
      return;
    }

    if (!wasmReady) {
      updateStatus(t('status.wasmStillLoading'), 'warn');
      return;
    }

		    try {
	      if (binaryBytes && binaryEncoding) {
	        let outputBytes: Uint8Array;
	        if (sameRtonEncoding(binaryEncoding, targetBinaryEncoding)) {
	          outputBytes = binaryBytes;
	        } else {
	          updateStatus(t('status.generatingHex', { encoding: formatRtonEncoding(targetBinaryEncoding, t) }), 'warn');
	          outputBytes = await runByteTransformInWorker({
	            kind: 'bytes',
	            source: binaryEncoding,
	            target: targetBinaryEncoding,
	            bytes: new Uint8Array(binaryBytes),
	          });
	        }
		        setLastOutputBytes(outputBytes.byteLength);
		        downloadBytes(outputBytes, outputBaseName(fileName, 'rton'));
	        updateStatus(t('format.generated', { label: `${formatRtonEncoding(targetBinaryEncoding, t)} RTON` }), 'ok');
	        return;
	      }

      const value = currentValueRef.current;
      if (!value) {
        throw new Error(parseError ?? t('status.noSearchableValue'));
      }
      updateStatus(t('status.generatingHex', { encoding: formatRtonEncoding(targetBinaryEncoding, t) }), 'warn');
      const outputBytes = await runByteTransformInWorker({
        kind: 'value',
        target: targetBinaryEncoding,
        value,
      });
      setLastOutputBytes(outputBytes.byteLength);
      downloadBytes(outputBytes, outputBaseName(fileName, 'rton'));
      updateStatus(t('format.generated', { label: `${formatRtonEncoding(targetBinaryEncoding, t)} RTON` }), 'ok');
    } catch (error) {
      updateStatus(errorMessage(error), 'error');
    }
	  };

  const downloadJson = () => {
    if (activeTabId === null) {
      updateStatus(t('status.openFileFirst'), 'warn');
      return;
    }

    try {
      const value = currentValueRef.current;
      if (!value) {
        throw new Error(parseError ?? t('status.noSearchableValue'));
      }
      downloadBlob(new Blob([rtonValueToJsonText(value, true)], { type: 'application/json' }), outputBaseName(fileName, 'json'));
      updateStatus(t('format.generated', { label: 'JSON' }), 'ok');
    } catch (error) {
      updateStatus(errorMessage(error), 'error');
    }
  };

  const downloadStructuredFormat = async (mode: StructuredFormatMode) => {
    if (activeTabId === null) {
      updateStatus(t('status.openFileFirst'), 'warn');
      return;
    }

    try {
      const value = currentValueRef.current;
      if (!value) {
        throw new Error(parseError ?? t('status.noSearchableValue'));
      }
      const { formatStructuredText } = await import('./format-conversion');
      const text = formatStructuredText(value, mode);
      downloadBlob(text, outputBaseName(fileName, mode), mode === 'yaml' ? 'application/yaml' : 'application/toml');
      updateStatus(t('format.generated', { label: mode.toUpperCase() }), 'ok');
    } catch (error) {
      updateStatus(errorMessage(error), 'error');
    }
  };

  const batchExportSelectedFiles = useCallback(
    async (mode: BatchExportMode) => {
      if (!wasmReady) {
        updateStatus(t('status.wasmStillLoading'), 'warn');
        return;
      }

      const selectedItems = loadedFileItems.filter((item) => selectedFileKeys.has(item.key));
      if (selectedItems.length === 0) {
        updateStatus(t('status.selectFilesFirst'), 'warn');
        return;
      }

      updateStatus(t('status.batchConverting', { count: selectedItems.length.toLocaleString(), format: mode.toUpperCase() }), 'warn');

      const tabsById = new Map(tabs.map((tab) => [tab.id, tab]));
      const filesById = new Map(loadedFiles.map((file) => [file.id, file]));
      const structuredFormatter =
        mode === 'yaml' || mode === 'toml' ? (await import('./format-conversion')).formatStructuredText : null;

      const result = await createBatchExportArchive({
        items: selectedItems,
        mode,
        resolveValue: (item) =>
          resolveBatchExportItemValue(item, {
            activeTabId,
            currentValue: currentValueRef.current,
            filesById,
            tabsById,
          }),
        encodeValue: (value) =>
          encodeBatchExportValue(value, mode, {
            compact: compactOutput,
            encrypted: encryptOutput,
            structuredFormatter,
          }),
        describeError: errorMessage,
      });

      if (!result.zipBytes) {
        updateStatus(result.errors[0] ?? t('status.noBatchSuccess'), 'error');
        return;
      }

      downloadBytes(result.zipBytes, `rton-editor-${mode}-${timestampForFileName()}.zip`);
      const errorSuffix = result.errors.length > 0 ? t('status.batchFailureSuffix', { count: result.errors.length.toLocaleString() }) : '';
      updateStatus(
        t('status.batchExported', { count: result.exportedCount.toLocaleString(), format: mode.toUpperCase(), suffix: errorSuffix }),
        result.errors.length > 0 ? 'warn' : 'ok',
      );
    },
    [
      activeTabId,
      compactOutput,
      encryptOutput,
      loadedFileItems,
      loadedFiles,
      selectedFileKeys,
      t,
      tabs,
      updateStatus,
      wasmReady,
    ],
  );

  const updateRtonValueNode = useCallback(
    (path: RtonValuePath, nextValue: RtonValue) => {
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
    },
    [activeTabId, parseError, renderTextForValue, setCurrentValueState, t, updateStatus],
  );

  const navigateToRtonValueNode = useCallback(
    (path: RtonValuePath) => {
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
    },
    [binaryBytes, displayedHexBytes, editorSurface, editorText, parseError, t, updateStatus],
  );

  const runEditorToolbarAction = useCallback(
    (kind: EditorShortcutKind) => {
      if (!hasActiveFile) {
        return;
      }

      if (!runActiveEditorShortcut(kind) && kind === 'find') {
        setEditorSearchPanelVisible(true);
      }
    },
    [hasActiveFile],
  );

  return (
    <main className="flex h-screen min-h-0 min-w-0 flex-col overflow-hidden bg-[var(--color-bg)] text-[var(--color-text)]">
      <AppToolbar
        t={t}
        canOpenHexEditor={hasActiveFile && Boolean(binaryBytes || currentValue)}
        compactOutput={compactOutput}
        displayFileName={displayFileName}
        displaySurfaceNote={displaySurfaceNote}
        editorSearchPanelVisible={editorSearchPanelVisible}
        editorSurface={editorSurface}
        encryptOutput={encryptOutput}
        hasActiveFile={hasActiveFile}
        lang={lang}
        languageOptions={languageOptions}
        lineWrapping={lineWrapping}
        themeOptions={themeOptions}
        themePreference={themePreference}
        viewMode={viewMode}
        wasmReady={wasmReady}
        onCompactOutputChange={(checked) => {
          setCompactOutput(checked);
          refreshOutputBytesForOptions();
        }}
        onDownloadJson={downloadJson}
        onDownloadRton={downloadRton}
        onDownloadStructuredFormat={downloadStructuredFormat}
        onEditorAction={runEditorToolbarAction}
        onEditorSearchPanelVisibleChange={setEditorSearchPanelVisible}
        onEncryptOutputChange={(checked) => {
          setEncryptOutput(checked);
          refreshOutputBytesForOptions();
        }}
        onLanguageChange={setLang}
        onLineWrappingChange={setLineWrapping}
        onLoadSample={loadSample}
        onOpenFiles={loadRtonFiles}
        onOpenFolder={loadRtonFolder}
        onOpenHexEditor={openHexEditor}
        onThemePreferenceChange={setThemePreference}
        onValidate={validateValue}
        onViewModeChange={setViewMode}
      />

      <div
        className={cx('rton-workspace-shell', dragging && 'outline outline-2 -outline-offset-2 outline-[var(--color-accent-border)]')}
        style={workspaceStyle}
        onDragOver={(event) => {
          event.preventDefault();
          setDragging(true);
        }}
        onDragLeave={() => setDragging(false)}
        onDrop={(event) => {
          event.preventDefault();
          setDragging(false);
          const dataTransfer = event.dataTransfer;
          void (async () => {
            const { entries, containsDirectory } = await collectDroppedEntries(dataTransfer);
            if (entries.length > 0) {
              if (containsDirectory) {
                stageRtonEntries(entries);
              } else {
                await loadRtonEntries(entries);
              }
            }
          })();
        }}
      >
        <EditorTabStrip
          tabs={tabs}
          activeTabId={activeTabId}
          fileName={fileName}
          onActivate={activateEditorTab}
          onClose={closeEditorTab}
          onMove={moveEditorTab}
        />

        <section className="rton-main-content">
          <FileListPanel
            t={t}
            fileListSubtitle={fileListSubtitle}
            fileSearchActive={fileSearchActive}
            fileSearchQuery={fileSearchQuery}
            filteredLoadedFileItems={filteredLoadedFileItems}
            listedFileCount={listedFileCount}
            selectedFileCount={selectedFileCount}
            selectedFileKeys={selectedFileKeys}
            selectedVisibleFileCount={selectedVisibleFileCount}
            visibleFileCount={visibleFileCount}
            wasmReady={wasmReady}
            onActivate={activateEditorTab}
            onBatchExport={(mode) => void batchExportSelectedFiles(mode)}
            onClearSearch={() => setFileSearchQuery('')}
            onClearSelectedFiles={clearSelectedFiles}
            onClose={closeEditorTab}
            onOpenFile={openLoadedFile}
            onSearchChange={setFileSearchQuery}
            onSelectAllListedFiles={selectAllListedFiles}
            onToggleSelected={toggleSelectedFile}
            onToggleSelectedMany={toggleSelectedFiles}
          />

        <PanelResizeHandle side="left" width={leftPanelWidth} onResize={resizePanel} />

        <EditorStage
          t={t}
          displayedHexBytes={displayedHexBytes}
          editorJumpTarget={editorJumpTarget}
          editorSearchPanelVisible={editorSearchPanelVisible}
          editorSurface={editorSurface}
          editorText={editorText}
          hasActiveFile={hasActiveFile}
          hexJumpTarget={hexJumpTarget}
          lineWrapping={lineWrapping}
          viewMode={viewMode}
          onEditorChange={onEditorInput}
          onHexChange={onHexBytesChange}
          onSearchPanelVisibleChange={setEditorSearchPanelVisible}
        />

        <PanelResizeHandle side="right" width={rightPanelWidth} onResize={resizePanel} />

        <RightInspectorPanel
          t={t}
          currentValue={currentValue}
          displayFileName={displayFileName}
          hasActiveFile={hasActiveFile}
          inputText={hasActiveFile ? (sourceBytes ? formatBytes(sourceBytes.byteLength) : t('app.textInput')) : t('app.noOutput')}
          outputText={outputText}
          searchQuery={searchQuery}
          searchState={searchState}
          stats={stats}
          onError={(message) => updateStatus(message, 'error')}
          onNavigate={navigateToRtonValueNode}
          onSearchChange={setSearchQuery}
          onValueChange={updateRtonValueNode}
        />
        </section>
      </div>

      <AppStatusBar
        displayFileName={displayFileName}
        outputLabel={t('app.output')}
        outputText={outputText}
        status={status}
      />
    </main>
  );
}

function errorMessage(error: unknown) {
  return error instanceof Error ? error.message : String(error);
}

function isDirectoryPickerGestureError(error: unknown) {
  return errorMessage(error).toLowerCase().includes('user gesture');
}
