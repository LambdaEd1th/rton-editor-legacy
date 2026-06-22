import { AppStatusBar } from '../components/app/AppStatusBar';
import { AppToolbar } from '../components/app/AppToolbar';
import { EditorStage } from '../components/editor/EditorStage';
import { EditorTabStrip } from '../components/editor/EditorTabStrip';
import { FileListPanel } from '../components/files/FileListPanel';
import { RightInspectorPanel } from '../components/inspector/RightInspectorPanel';
import { PanelResizeHandle } from '../components/panels/Panels';
import { cx } from '../utils/ui-classes';
import type { RtonEditorController } from './controller';

export function RtonEditorShell({ controller }: { controller: RtonEditorController }) {
  const {
    activeTabId,
    canOpenHexEditor,
    compactOutput,
    currentValue,
    displayFileName,
    displaySurfaceNote,
    displayedHexBytes,
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
    onActivateTab,
    onBatchExportSelectedFiles,
    onClearFileSearch,
    onClearSelectedFiles,
    onCloseTab,
    onCompactOutputChange,
    onDownloadJson,
    onDownloadRton,
    onDownloadStructuredFormat,
    onEditorAction,
    onEditorChange,
    onEditorSearchPanelVisibleChange,
    onEncryptOutputChange,
    onFileSearchChange,
    onHexChange,
    onInspectorError,
    onLoadDocumentChildren,
    onLanguageChange,
    onLineWrappingChange,
    onLoadSample,
    onMoveTab,
    onOpenFile,
    onOpenFiles,
    onOpenFolder,
    onOpenHexEditor,
    onResizePanel,
    onRtonValueNavigate,
    onRtonValueUpdate,
    onSearchChange,
    onSelectAllListedFiles,
    onThemePreferenceChange,
    onToggleSelectedFile,
    onToggleSelectedFiles,
    onValidate,
    onViewModeChange,
    onWorkspaceDragLeave,
    onWorkspaceDragOver,
    onWorkspaceDrop,
  } = controller;

  return (
    <main className="flex h-screen min-h-0 min-w-0 flex-col overflow-hidden bg-[var(--color-bg)] text-[var(--color-text)]">
      <AppToolbar
        t={t}
        canOpenHexEditor={canOpenHexEditor}
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
        onCompactOutputChange={onCompactOutputChange}
        onDownloadJson={onDownloadJson}
        onDownloadRton={onDownloadRton}
        onDownloadStructuredFormat={onDownloadStructuredFormat}
        onEditorAction={onEditorAction}
        onEditorSearchPanelVisibleChange={onEditorSearchPanelVisibleChange}
        onEncryptOutputChange={onEncryptOutputChange}
        onLanguageChange={onLanguageChange}
        onLineWrappingChange={onLineWrappingChange}
        onLoadSample={onLoadSample}
        onOpenFiles={onOpenFiles}
        onOpenFolder={onOpenFolder}
        onOpenHexEditor={onOpenHexEditor}
        onThemePreferenceChange={onThemePreferenceChange}
        onValidate={onValidate}
        onViewModeChange={onViewModeChange}
      />

      <div
        className={cx('rton-workspace-shell', dragging && 'outline outline-2 -outline-offset-2 outline-[var(--color-accent-border)]')}
        style={workspaceStyle}
        onDragOver={onWorkspaceDragOver}
        onDragLeave={onWorkspaceDragLeave}
        onDrop={onWorkspaceDrop}
      >
        <EditorTabStrip
          tabs={tabs}
          activeTabId={activeTabId}
          fileName={fileName}
          onActivate={onActivateTab}
          onClose={onCloseTab}
          onMove={onMoveTab}
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
            onActivate={onActivateTab}
            onBatchExport={onBatchExportSelectedFiles}
            onClearSearch={onClearFileSearch}
            onClearSelectedFiles={onClearSelectedFiles}
            onClose={onCloseTab}
            onOpenFile={onOpenFile}
            onSearchChange={onFileSearchChange}
            onSelectAllListedFiles={onSelectAllListedFiles}
            onToggleSelected={onToggleSelectedFile}
            onToggleSelectedMany={onToggleSelectedFiles}
          />

          <PanelResizeHandle side="left" width={leftPanelWidth} onResize={onResizePanel} />

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
            onEditorChange={onEditorChange}
            onHexChange={onHexChange}
            onSearchPanelVisibleChange={onEditorSearchPanelVisibleChange}
          />

          <PanelResizeHandle side="right" width={rightPanelWidth} onResize={onResizePanel} />

          <RightInspectorPanel
            t={t}
            currentValue={currentValue}
            rtonDocument={rtonDocument}
            displayFileName={displayFileName}
            hasActiveFile={hasActiveFile}
            inputText={inputText}
            outputText={outputText}
            searchQuery={searchQuery}
            searchState={searchState}
            stats={stats}
            onError={onInspectorError}
            onLoadDocumentChildren={onLoadDocumentChildren}
            onNavigate={onRtonValueNavigate}
            onSearchChange={onSearchChange}
            onValueChange={onRtonValueUpdate}
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
