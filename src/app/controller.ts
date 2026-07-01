import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
  type DragEvent,
} from 'react';
import init from '../wasm/rton-editor/rton_editor_wasm';
import type { TabDropPlacement } from '../components/editor/EditorTabStrip';
import { runActiveEditorShortcut, type EditorShortcutKind } from '../components/editor/keyboard-shortcuts';
import type { RtonInlineSelectOption } from '../components/inspector/RtonInlineSelect';
import type { PanelSide } from '../components/panels/Panels';
import { useI18n } from '../localization/use-i18n';
import { useHexEditActions } from '../hooks/hex-edit-actions';
import { useActiveEditorState } from '../hooks/active-editor-state';
import { sampleJson } from '../fixtures/sample';
import { emptyStats } from '../domain/rton-value-analysis';
import { useTextFormatFlow } from '../hooks/text-format-flow';
import { useRtonValueActions } from '../hooks/rton-value-actions';
import { useRtonValueSearch } from '../hooks/rton-value-search';
import { collectDroppedEntries } from '../files/file-loading';
import { useFileImportActions } from '../hooks/file-import-actions';
import { formatBytes } from '../files/file-export';
import type { BatchExportMode } from '../files/batch-export';
import { useExportActions } from '../hooks/export-actions';
import {
  parseJsonTextToRtonValue,
  rtonValueToJsonText,
  type RtonBinaryEncoding,
  type StatusState,
} from '../domain/rton-codec';
import { createEditorTabFromValue, type EditorTab } from '../workspace/editor-tabs';
import {
  appendEditorTabs,
  closeEditorTabState,
  createActiveEditorTabSnapshot,
  findEditorTab,
  moveEditorTabState,
  syncActiveEditorTab,
  unlinkLoadedFileTab,
} from '../workspace/editor-workspace';
import {
  applyThemePreference,
  previewPreferenceTextMode,
  readLineWrappingPreference,
  readPreviewPreference,
  readThemePreference,
  saveLineWrappingPreference,
  savePreviewPreference,
  saveThemePreference,
  SYSTEM_DARK_QUERY,
  type PreviewPreference,
  type ThemePreference,
} from '../workspace/preferences';
import type { LoadedRtonFile } from '../files/loaded-file-items';
import { useLoadedFileListState } from '../hooks/loaded-file-list-state';
import {
  clampPanelWidth,
  LEFT_PANEL_DEFAULT_WIDTH,
  RIGHT_PANEL_DEFAULT_WIDTH,
} from '../workspace/panel-layout';
import {
  useBatchExportWorker,
  useByteTransformWorker,
  useRtonDecodeWorker,
  useTextTaskWorker,
  type RtonDocumentValueUpdateOutput,
} from '../hooks/worker-clients';
import { buildOutputText } from './output-summary';
import { readHexByteSourceRange, type HexByteSource } from '../domain/hex-byte-source';
import type { RtonDocumentEditOperation } from '../domain/rton-value-editing';

const SEARCH_DEBOUNCE_MS = 140;
const EDITOR_PARSE_DEBOUNCE_MS = 450;
const FORMAT_WORKER_TIMEOUT_MS = 20_000;

if (typeof window !== 'undefined' && typeof document !== 'undefined') {
  applyThemePreference(readThemePreference());
}

export function useRtonEditorController() {
  const { lang, langs, getLangLabel, setLang, t } = useI18n();
  const [tabs, setTabs] = useState<EditorTab[]>([]);
  const [loadedFiles, setLoadedFiles] = useState<LoadedRtonFile[]>([]);
  const [activeTabId, setActiveTabId] = useState<number | null>(null);
  const [wasmReady, setWasmReady] = useState(false);
  const [dragging, setDragging] = useState(false);
  const [leftPanelWidth, setLeftPanelWidth] = useState(LEFT_PANEL_DEFAULT_WIDTH);
  const [rightPanelWidth, setRightPanelWidth] = useState(RIGHT_PANEL_DEFAULT_WIDTH);
  const [themePreference, setThemePreference] = useState<ThemePreference>(() => readThemePreference());
  const [lineWrapping, setLineWrapping] = useState(() => readLineWrappingPreference());
  const [previewPreference, setPreviewPreference] = useState<PreviewPreference>(() => readPreviewPreference());
  const [editorSearchPanelVisible, setEditorSearchPanelVisible] = useState(false);
  const [rtonIndexBuilding, setRtonIndexBuilding] = useState(false);

  const nextTabId = useRef(1);
  const nextLoadedFileId = useRef(1);
  const nextEditorJumpId = useRef(1);
  const nextHexJumpId = useRef(1);
  const batchExportModeRef = useRef<BatchExportMode>('rton');
  const {
    binaryBytes,
    binaryEncoding,
    compactOutput,
    currentValue,
    currentValueRef,
    editorJumpTarget,
    editorSurface,
    editorText,
    encryptOutput,
    fileName,
    hexByteSource,
    hexJumpTarget,
    lastOutputBytes,
    parseError,
    parsedJson,
    rtonDocument,
    setBinaryBytes,
    setBinaryEncoding,
    setCompactOutput,
    setCurrentValueState,
    setEditorJumpTarget,
    setEditorSurface,
    setEditorTextState,
    setEncryptOutput,
    setFileName,
    setHexByteSource,
    setHexJumpTarget,
    setLastOutputBytes,
    setParseError,
    setParsedJson,
    setRtonDocument,
    setSourceBytes,
    setStats,
    setStatus,
    setSurfaceNote,
    setViewModeState,
    sourceBytes,
    stats,
    status,
    surfaceNote,
    updateStatus,
    viewMode,
    viewModeRef,
  } = useActiveEditorState({ activeTabId, initialViewMode: previewPreferenceTextMode(previewPreference), t });
  const { runByteTransformInWorker, runByteTransformSizeInWorker } = useByteTransformWorker({
    t,
    onError: (message) => updateStatus(message, 'error'),
  });
  const { runTextExportInWorker, runTextParseInWorker } = useTextTaskWorker({
    t,
    onError: (message) => updateStatus(message, 'error'),
  });
  const { runBatchExportInWorker } = useBatchExportWorker({
    t,
    onError: (message) => updateStatus(message, 'error'),
    onProgress: (completed, total) => {
      updateStatus(
        t('status.batchProgress', {
          format: batchExportModeRef.current.toUpperCase(),
          completed: completed.toLocaleString(),
          total: total.toLocaleString(),
        }),
        'warn',
      );
    },
  });
  const {
    editRtonDocument,
    getRtonDocumentByteRange,
    getRtonDocumentChildren,
    exportRtonDocumentBytes,
    exportRtonDocumentSize,
    exportRtonDocumentText,
    locateRtonDocumentOffset,
    releaseRtonDocument,
    replaceRtonDocumentBytes,
    runRtonDecodeFileInWorker,
    runRtonDecodeInWorker,
    searchRtonDocument,
    updateRtonDocumentValue,
  } = useRtonDecodeWorker({
    t,
    onError: (message) => updateStatus(message, 'error'),
  });
  const {
    cancelSearch,
    searchQuery,
    searchState,
    setSearchQuery,
    setSearchState,
  } = useRtonValueSearch({
    activeTabId,
    currentValue,
    debounceMs: SEARCH_DEBOUNCE_MS,
    parseError,
    rtonDocument,
    searchRtonDocument,
    t,
  });
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

  const {
    clearParseTimer,
    invalidateFormatWork,
    renderTextForValue,
    scheduleEditorParse,
    setViewMode,
  } = useTextFormatFlow({
    activeTabId,
    cancelSearch,
    currentValueRef,
    debounceMs: EDITOR_PARSE_DEBOUNCE_MS,
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
    timeoutMs: FORMAT_WORKER_TIMEOUT_MS,
    updateStatus,
    viewModeRef,
    wasmReady,
  });

  const clearPendingWork = useCallback(() => {
    clearParseTimer();
    cancelSearch();
    invalidateFormatWork();
  }, [cancelSearch, clearParseTimer, invalidateFormatWork]);

  const snapshotActiveTab = useCallback(
    () =>
      createActiveEditorTabSnapshot({
        activeTabId,
        fileName,
        sourceBytes,
        binaryBytes,
        hexByteSource,
        binaryEncoding,
        currentValue: currentValueRef.current,
        rtonDocument,
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
      hexByteSource,
      lastOutputBytes,
      parseError,
      parsedJson,
      rtonDocument,
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
      const preferredTextMode = previewPreferenceTextMode(previewPreference);
      clearPendingWork();
      viewModeRef.current = preferredTextMode;

      setActiveTabId(null);
      setFileName('');
      setSourceBytes(null);
      setBinaryBytes(null);
      setHexByteSource(null);
      setBinaryEncoding(null);
      setCurrentValueState(null);
      setRtonDocument(null);
      setEditorTextState('');
      setEditorJumpTarget(null);
      setHexJumpTarget(null);
      setLastOutputBytes(null);
      setParsedJson(null);
      setParseError(null);
      setStats(emptyStats());
      setViewModeState(preferredTextMode);
      setEditorSurface('text');
      setSurfaceNote(t('app.waitingFile'));
      setSearchQuery('');
      setSearchState({ kind: 'message', message: t('app.emptyFile') });
      setEditorSearchPanelVisible(false);
      setStatus(nextStatus);
    },
    [clearPendingWork, previewPreference, setCurrentValueState, setHexByteSource, setRtonDocument, t],
  );

  const restoreEditorTab = useCallback(
    (tab: EditorTab) => {
      clearPendingWork();
      viewModeRef.current = tab.viewMode;

      setActiveTabId(tab.id);
      setFileName(tab.fileName);
      setSourceBytes(tab.sourceBytes);
      setBinaryBytes(tab.binaryBytes);
      setHexByteSource(tab.hexByteSource);
      setBinaryEncoding(tab.binaryEncoding);
      setCurrentValueState(tab.currentValue);
      setRtonDocument(tab.rtonDocument);
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
    [clearPendingWork, setCurrentValueState, setHexByteSource, setRtonDocument],
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

  const buildRtonIndex = useCallback(() => {
    if (activeTabId === null || (!binaryBytes && !hexByteSource) || rtonDocument || currentValueRef.current) {
      return;
    }
    if (!binaryBytes && hexByteSource?.kind !== 'file') {
      return;
    }

    setRtonIndexBuilding(true);
    updateStatus(t('status.largeRtonIndexing'), 'warn');
    const indexedFileSource = hexByteSource?.kind === 'file' ? hexByteSource : null;
    const decodePromise = binaryBytes
      ? runRtonDecodeInWorker(new Uint8Array(binaryBytes), { includeValue: false, retainDocument: true, includeBytes: false })
      : runRtonDecodeFileInWorker(indexedFileSource!.file, { includeValue: false, retainDocument: true, includeBytes: false });
    void decodePromise
      .then(({ document, stats, plainBytes, compact, encrypted }) => {
        if (!document) {
          throw new Error(t('status.largeRtonIndexFailed'));
        }
        if (plainBytes) {
          setSourceBytes(plainBytes);
          setBinaryBytes(plainBytes);
          setHexByteSource(null);
          setBinaryEncoding({ compact, encrypted: false });
        } else if (indexedFileSource) {
          setSourceBytes(null);
          setBinaryBytes(null);
          setHexByteSource({
            ...indexedFileSource,
            binaryEncoding: { compact, encrypted },
          });
          setBinaryEncoding({ compact, encrypted });
        } else {
          setBinaryEncoding({ compact, encrypted: false });
        }
        setRtonDocument(document);
        setStats(stats);
        setSurfaceNote(t('format.largeDocumentMode'));
        setSearchState({ kind: 'idle' });
        setStatus({ message: t('status.largeRtonIndexed'), tone: 'ok' });
      })
      .catch((error: unknown) => {
        const message = `${t('status.largeRtonIndexFailed')}: ${errorMessage(error)}`;
        setSurfaceNote(t('format.largeDocumentIndexFailed'));
        setSearchState({ kind: 'message', message });
        setStatus({ message, tone: 'error' });
      })
      .finally(() => setRtonIndexBuilding(false));
  }, [
    activeTabId,
    binaryBytes,
    currentValueRef,
    hexByteSource,
    rtonDocument,
    runRtonDecodeInWorker,
    runRtonDecodeFileInWorker,
    setBinaryBytes,
    setBinaryEncoding,
    setHexByteSource,
    setRtonDocument,
    setSearchState,
    setSourceBytes,
    setStats,
    setStatus,
    setSurfaceNote,
    t,
    updateStatus,
  ]);

  const closeEditorTab = useCallback(
    (tabId: number) => {
      const syncedTabs = syncActiveTab();
      const closingDocument = syncedTabs.find((tab) => tab.id === tabId)?.rtonDocument ?? null;
      const result = closeEditorTabState(syncedTabs, tabId, activeTabId);
      if (!result.closed) {
        return;
      }

      if (closingDocument) {
        void releaseRtonDocument(closingDocument.id).catch(() => undefined);
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
    [activeTabId, releaseRtonDocument, restoreEditorTab, restoreEmptyWorkspace, syncActiveTab, t],
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

  const hasActiveFile = activeTabId !== null && tabs.length > 0;
  const displayFileName = hasActiveFile ? fileName : t('app.emptyFile');
  const targetBinaryEncoding = useMemo<RtonBinaryEncoding>(
    () => ({ compact: compactOutput, encrypted: encryptOutput }),
    [compactOutput, encryptOutput],
  );
  const displayedHexBytes = binaryBytes;
  const displayedHexSource = useMemo<HexByteSource | null>(() => {
    if (binaryBytes) {
      return null;
    }

    if (rtonDocument) {
      return {
        kind: 'document',
        documentId: rtonDocument.id,
        byteLength: rtonDocument.byteLength,
        binaryEncoding: { compact: binaryEncoding?.compact ?? false, encrypted: false },
      };
    }

    return hexByteSource;
  }, [binaryBytes, binaryEncoding, hexByteSource, rtonDocument]);
  const outputText = buildOutputText({
    binaryBytes,
    binaryEncoding,
    editorSurface,
    editorText,
    hasActiveFile,
    hexByteSource: displayedHexSource,
    lastOutputBytes,
    surfaceNote,
    targetBinaryEncoding,
    t,
    viewMode,
  });
  const displaySurfaceNote =
    editorSurface === 'hex'
      ? binaryBytes || displayedHexSource
        ? `RTON · ${formatBytes(binaryBytes?.byteLength ?? displayedHexSource?.byteLength ?? 0)}`
        : t('app.rtonUnavailable')
      : surfaceNote;

  const {
    clearSelectedFiles,
    fileListSubtitle,
    fileSearchActive,
    fileSearchQuery,
    filteredLoadedFileItems,
    listedFileCount,
    loadedFileItems,
    selectAllListedFiles,
    selectedFileCount,
    selectedFileKeys,
    selectedVisibleFileCount,
    setFileSearchQuery,
    toggleSelectedFile,
    toggleSelectedFiles,
    visibleFileCount,
  } = useLoadedFileListState({
    activeTabId,
    editorSurface,
    fileName,
    lang,
    loadedFiles,
    hexByteSource: displayedHexSource,
    sourceBytes,
    tabs,
    t,
    viewMode,
  });

  const {
    batchExportSelectedFiles,
    downloadJson,
    downloadRton,
    downloadStructuredFormat,
    refreshOutputBytesForOptions,
    validateValue,
  } = useExportActions({
    activeTabId,
    binaryBytes,
    binaryEncoding,
    compactOutput,
    currentValueRef,
    hexByteSource,
    rtonDocument,
    editorSurface,
    encryptOutput,
    fileName,
    loadedFileItems,
    loadedFiles,
    parseError,
    selectedFileKeys,
    setLastOutputBytes,
    tabs,
    targetBinaryEncoding,
    t,
    updateStatus,
    viewModeRef,
    wasmReady,
    exportRtonDocumentBytes,
    exportRtonDocumentSize,
    exportRtonDocumentText,
    runBatchExportInWorker,
    runByteTransformInWorker,
    runByteTransformSizeInWorker,
    runTextExportInWorker,
  });

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
    void init()
      .then(() => {
        setWasmReady(true);
        updateStatus(t('status.wasmReady'), 'ok');
      })
      .catch((error: unknown) => {
        updateStatus(errorMessage(error), 'error');
      });
  }, [t, updateStatus]);

  useEffect(() => {
    if (wasmReady && activeTabId !== null) {
      validateValue();
    }
  }, [activeTabId, validateValue, wasmReady]);

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

  const onEditorInput = (value: string) => {
    if (activeTabId === null) {
      return;
    }

    setBinaryBytes(null);
    setHexByteSource(null);
    setBinaryEncoding(null);
    setRtonDocument(null);
    setEditorTextState(value);
    scheduleEditorParse(viewModeRef.current, value);
  };

  const {
    onHexBytesChange,
    openHexEditor,
  } = useHexEditActions({
    activeTabId,
    binaryBytes,
    clearPendingWork,
    compactOutput,
    currentValueRef,
    hexByteSource,
    rtonDocument,
    invalidateFormatWork,
    parseError,
    renderTextForValue,
    setBinaryBytes,
    setBinaryEncoding,
    setCurrentValueState,
    setEditorSurface,
    setHexByteSource,
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
  });

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

  const {
    loadRtonEntries,
    loadRtonFiles,
    loadRtonFolder,
    openLoadedFile,
    stageRtonEntries,
  } = useFileImportActions({
    activeTabId,
    activateEditorTab,
    editorSurface,
    loadedFiles,
    nextLoadedFileId,
    nextTabId,
    openEditorTabs,
    previewPreference,
    renderTextForValue,
    runTextParseInWorker,
    runRtonDecodeFileInWorker,
    setLoadedFiles,
    tabs,
    t,
    updateStatus,
    viewModeRef,
    wasmReady,
  });

  const {
    navigateToRtonValueNode,
    updateRtonValueNode,
  } = useRtonValueActions({
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
  });

  const applyRemoteRtonDocumentUpdate = useCallback(
    ({ document, stats, compact }: RtonDocumentValueUpdateOutput) => {
      setRtonDocument(document);
      setStats(stats);
      setBinaryBytes(null);
      setSourceBytes(null);
      setHexByteSource(null);
      setBinaryEncoding({ compact, encrypted: false });
      setParsedJson(null);
      setParseError(null);
      setLastOutputBytes(null);
      setSearchState({ kind: 'idle' });
      setSurfaceNote(t('format.largeDocumentMode'));
      setStatus({ message: t('status.rtonValueUpdated'), tone: 'ok' });
    },
    [
      setBinaryBytes,
      setBinaryEncoding,
      setHexByteSource,
      setLastOutputBytes,
      setParseError,
      setParsedJson,
      setRtonDocument,
      setSearchState,
      setSourceBytes,
      setStats,
      setStatus,
      setSurfaceNote,
      t,
    ],
  );

  const updateInspectorValueNode = useCallback(
    (path: Parameters<typeof updateRtonValueNode>[0], nextValue: Parameters<typeof updateRtonValueNode>[1]) => {
      if (!rtonDocument || currentValueRef.current) {
        updateRtonValueNode(path, nextValue);
        return;
      }

      void updateRtonDocumentValue(rtonDocument.id, path, nextValue)
        .then(applyRemoteRtonDocumentUpdate)
        .catch((error: unknown) => {
          updateStatus(errorMessage(error), 'error');
        });
    },
    [
      applyRemoteRtonDocumentUpdate,
      currentValueRef,
      rtonDocument,
      updateRtonDocumentValue,
      updateRtonValueNode,
      updateStatus,
    ],
  );

  const editInspectorDocumentNode = useCallback(
    (operation: RtonDocumentEditOperation) => {
      if (!rtonDocument || currentValueRef.current) {
        return;
      }

      void editRtonDocument(rtonDocument.id, operation)
        .then(applyRemoteRtonDocumentUpdate)
        .catch((error: unknown) => {
          updateStatus(errorMessage(error), 'error');
        });
    },
    [applyRemoteRtonDocumentUpdate, currentValueRef, editRtonDocument, rtonDocument, updateStatus],
  );

  const navigateInspectorNode = useCallback(
    (path: Parameters<typeof navigateToRtonValueNode>[0]) => {
      if (!rtonDocument || currentValueRef.current) {
        navigateToRtonValueNode(path);
        return;
      }

      void locateRtonDocumentOffset(rtonDocument.id, path)
        .then((offset) => {
          if (offset === null) {
            updateStatus(t('status.offsetNotFound'), 'warn');
            return;
          }
          setEditorSurface('hex');
          setHexJumpTarget({
            id: nextHexJumpId.current,
            offset,
          });
          nextHexJumpId.current += 1;
          updateStatus(t('status.jumpedOffset', { offset: offset.toString(16).toUpperCase() }), 'ok');
        })
        .catch((error: unknown) => {
          updateStatus(errorMessage(error), 'error');
        });
    },
    [
      currentValueRef,
      locateRtonDocumentOffset,
      navigateToRtonValueNode,
      rtonDocument,
      setEditorSurface,
      setHexJumpTarget,
      t,
      updateStatus,
    ],
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

  const selectPreviewPreference = useCallback((preference: PreviewPreference) => {
    setPreviewPreference(preference);
    savePreviewPreference(preference);
  }, []);

  const selectTextViewMode = useCallback(
    (mode: Exclude<PreviewPreference, 'rton'>) => {
      selectPreviewPreference(mode);
      setViewMode(mode);
    },
    [selectPreviewPreference, setViewMode],
  );

  const openPreferredHexEditor = useCallback(() => {
    selectPreviewPreference('rton');
    openHexEditor();
  }, [openHexEditor, selectPreviewPreference]);

  const inputText = hasActiveFile
    ? sourceBytes
      ? formatBytes(sourceBytes.byteLength)
      : displayedHexSource
        ? formatBytes(displayedHexSource.byteLength)
        : t('app.textInput')
    : t('app.noOutput');
  const canOpenHexEditor = hasActiveFile && Boolean(binaryBytes || hexByteSource || currentValue || rtonDocument);
  const canBuildRtonIndex = hasActiveFile && Boolean((binaryBytes || hexByteSource?.kind === 'file') && binaryEncoding && !currentValue && !rtonDocument);

  const onCompactOutputChange = useCallback(
    (checked: boolean) => {
      setCompactOutput(checked);
      void refreshOutputBytesForOptions({ compact: checked, encrypted: encryptOutput });
    },
    [encryptOutput, refreshOutputBytesForOptions, setCompactOutput],
  );

  const onEncryptOutputChange = useCallback(
    (checked: boolean) => {
      setEncryptOutput(checked);
      void refreshOutputBytesForOptions({ compact: compactOutput, encrypted: checked });
    },
    [compactOutput, refreshOutputBytesForOptions, setEncryptOutput],
  );

  const onClearFileSearch = useCallback(() => {
    setFileSearchQuery('');
  }, [setFileSearchQuery]);

  const onBatchExportSelectedFiles = useCallback(
    (mode: BatchExportMode) => {
      batchExportModeRef.current = mode;
      void batchExportSelectedFiles(mode);
    },
    [batchExportSelectedFiles],
  );

  const onInspectorError = useCallback(
    (message: string) => {
      updateStatus(message, 'error');
    },
    [updateStatus],
  );

  const onReadHexRange = useCallback(
    async (source: HexByteSource, start: number, end: number) => {
      if (source.kind === 'document') {
        const result = await getRtonDocumentByteRange(source.documentId, start, end);
        return result.bytes;
      }

      return readHexByteSourceRange(source, start, end);
    },
    [getRtonDocumentByteRange],
  );

  const onWorkspaceDragOver = useCallback((event: DragEvent<HTMLElement>) => {
    event.preventDefault();
    setDragging(true);
  }, []);

  const onWorkspaceDragLeave = useCallback(() => {
    setDragging(false);
  }, []);

  const onWorkspaceDrop = useCallback(
    (event: DragEvent<HTMLElement>) => {
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
    },
    [loadRtonEntries, stageRtonEntries],
  );

  return {
    activeTabId,
    binaryBytes,
    canBuildRtonIndex,
    canOpenHexEditor,
    compactOutput,
    currentValue,
    displayFileName,
    displaySurfaceNote,
    displayedHexBytes,
    displayedHexSource,
    dragging,
    editorJumpTarget,
    editorSearchPanelVisible,
    editorSurface,
    editorText,
    encryptOutput,
    fileListSubtitle,
    fileName,
    fileSearchActive,
    fileSearchQuery,
    filteredLoadedFileItems,
    hasActiveFile,
    hexJumpTarget,
    inputText,
    lang,
    languageOptions,
    leftPanelWidth,
    lineWrapping,
    listedFileCount,
    outputText,
    rightPanelWidth,
    rtonDocument,
    rtonIndexBuilding,
    searchQuery,
    searchState,
    selectedFileCount,
    selectedFileKeys,
    selectedVisibleFileCount,
    stats,
    status,
    t,
    tabs,
    themeOptions,
    themePreference,
    viewMode,
    visibleFileCount,
    wasmReady,
    workspaceStyle,
    onActivateTab: activateEditorTab,
    onBatchExportSelectedFiles,
    onBuildRtonIndex: buildRtonIndex,
    onClearFileSearch,
    onClearSelectedFiles: clearSelectedFiles,
    onCloseTab: closeEditorTab,
    onCompactOutputChange,
    onDownloadJson: downloadJson,
    onDownloadRton: downloadRton,
    onDownloadStructuredFormat: downloadStructuredFormat,
    onEditorAction: runEditorToolbarAction,
    onEditorChange: onEditorInput,
    onEditorSearchPanelVisibleChange: setEditorSearchPanelVisible,
    onEncryptOutputChange,
    onHexChange: onHexBytesChange,
    onInspectorError,
    onLoadDocumentChildren: getRtonDocumentChildren,
    onLanguageChange: setLang,
    onLineWrappingChange: setLineWrapping,
    onLoadSample: loadSample,
    onMoveTab: moveEditorTab,
    onOpenFile: openLoadedFile,
    onOpenFiles: loadRtonFiles,
    onOpenFolder: loadRtonFolder,
    onOpenHexEditor: openPreferredHexEditor,
    onReadHexRange,
    onResizePanel: resizePanel,
    onRtonValueNavigate: navigateInspectorNode,
    onRtonDocumentEdit: editInspectorDocumentNode,
    onRtonValueUpdate: updateInspectorValueNode,
    onSearchChange: setSearchQuery,
    onSelectAllListedFiles: selectAllListedFiles,
    onThemePreferenceChange: setThemePreference,
    onToggleSelectedFile: toggleSelectedFile,
    onToggleSelectedFiles: toggleSelectedFiles,
    onValidate: validateValue,
    onViewModeChange: selectTextViewMode,
    onWorkspaceDragLeave,
    onWorkspaceDragOver,
    onWorkspaceDrop,
    onFileSearchChange: setFileSearchQuery,
  };
}

export type RtonEditorController = ReturnType<typeof useRtonEditorController>;


function errorMessage(error: unknown) {
  return error instanceof Error ? error.message : String(error);
}
