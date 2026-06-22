import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
} from 'react';
import init from './wasm/rton-editor/rton_editor_wasm';
import { AppToolbar } from './components/app/AppToolbar';
import { EditorStage } from './components/editor/EditorStage';
import { EditorTabStrip, type TabDropPlacement } from './components/editor/EditorTabStrip';
import { AppStatusBar } from './components/app/AppStatusBar';
import { FileListPanel } from './components/files/FileListPanel';
import { RightInspectorPanel } from './components/inspector/RightInspectorPanel';
import { PanelResizeHandle, type PanelSide } from './components/panels/Panels';
import { useI18n } from './localization/use-i18n';
import { useHexEditActions } from './hooks/hex-edit-actions';
import { useActiveEditorState } from './hooks/active-editor-state';
import { sampleJson } from './fixtures/sample';
import { runActiveEditorShortcut, type EditorShortcutKind } from './components/editor/keyboard-shortcuts';
import type { RtonInlineSelectOption } from './components/inspector/RtonInlineSelect';
import { emptyStats } from './domain/rton-value-analysis';
import { useTextFormatFlow } from './hooks/text-format-flow';
import { useRtonValueActions } from './hooks/rton-value-actions';
import { useRtonValueSearch } from './hooks/rton-value-search';
import {
  collectDroppedEntries,
} from './files/file-loading';
import { useFileImportActions } from './hooks/file-import-actions';
import {
  formatBytes,
} from './files/file-export';
import { useExportActions } from './hooks/export-actions';
import {
  parseJsonTextToRtonValue,
  rtonValueToJsonText,
  type RtonBinaryEncoding,
  type StatusState,
} from './domain/rton-codec';
import { createEditorTabFromValue, type EditorTab } from './workspace/editor-tabs';
import {
  appendEditorTabs,
  closeEditorTabState,
  createActiveEditorTabSnapshot,
  findEditorTab,
  moveEditorTabState,
  syncActiveEditorTab,
  unlinkLoadedFileTab,
} from './workspace/editor-workspace';
import {
  applyThemePreference,
  readLineWrappingPreference,
  readThemePreference,
  saveLineWrappingPreference,
  saveThemePreference,
  SYSTEM_DARK_QUERY,
  type ThemePreference,
} from './workspace/preferences';
import type { LoadedRtonFile } from './files/loaded-file-items';
import { useLoadedFileListState } from './hooks/loaded-file-list-state';
import {
  clampPanelWidth,
  LEFT_PANEL_DEFAULT_WIDTH,
  RIGHT_PANEL_DEFAULT_WIDTH,
} from './workspace/panel-layout';
import { cx } from './utils/ui-classes';
import {
  useByteTransformWorker,
} from './hooks/worker-clients';

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
  const [activeTabId, setActiveTabId] = useState<number | null>(null);
  const [wasmReady, setWasmReady] = useState(false);
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
    hexJumpTarget,
    lastOutputBytes,
    parseError,
    parsedJson,
    setBinaryBytes,
    setBinaryEncoding,
    setCompactOutput,
    setCurrentValueState,
    setEditorJumpTarget,
    setEditorSurface,
    setEditorTextState,
    setEncryptOutput,
    setFileName,
    setHexJumpTarget,
    setLastOutputBytes,
    setParseError,
    setParsedJson,
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
  } = useActiveEditorState({ activeTabId, t });
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

  const { runByteTransformInWorker } = useByteTransformWorker({
    t,
    onError: (message) => updateStatus(message, 'error'),
  });

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

  const hasActiveFile = activeTabId !== null && tabs.length > 0;
  const displayFileName = hasActiveFile ? fileName : t('app.emptyFile');
  const targetBinaryEncoding = useMemo<RtonBinaryEncoding>(
    () => ({ compact: compactOutput, encrypted: encryptOutput }),
    [compactOutput, encryptOutput],
  );
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
    runByteTransformInWorker,
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
	    setBinaryEncoding(null);
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
    encryptOutput,
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
    renderTextForValue,
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
