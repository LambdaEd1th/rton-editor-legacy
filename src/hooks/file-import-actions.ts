import { useCallback } from 'react';
import { createEditorTabFromValue, type EditorTab } from '../workspace/editor-tabs';
import {
  collectDirectoryEntries,
  collectLoadableCandidates,
  displayFilePath,
  LOADABLE_FILE_HINT,
  normalizeDisplayPath,
  type DirectoryPickerWindow,
  type RtonLoadEntry,
} from '../files/file-loading';
import type { LoadedRtonFile } from '../files/loaded-file-items';
import type { Translator } from '../localization/i18n';
import type { PreviewPreference } from '../workspace/preferences';
import {
  decodeLoadableSource,
  isPendingTextPreview,
  type EditorSurface,
  type Tone,
  type ViewMode,
} from '../domain/rton-codec';
import type { RtonValue } from '../domain/rton-value';

export function useFileImportActions({
  activeTabId,
  activateEditorTab,
  editorSurface,
  loadedFiles,
  nextLoadedFileId,
  nextTabId,
  openEditorTabs,
  previewPreference,
  renderTextForValue,
  setLoadedFiles,
  tabs,
  t,
  updateStatus,
  viewModeRef,
  wasmReady,
}: {
  activeTabId: number | null;
  activateEditorTab: (tabId: number) => void;
  editorSurface: EditorSurface;
  loadedFiles: LoadedRtonFile[];
  nextLoadedFileId: { current: number };
  nextTabId: { current: number };
  openEditorTabs: (tabs: EditorTab[]) => void;
  previewPreference: PreviewPreference;
  renderTextForValue: (value: RtonValue, mode: ViewMode) => boolean;
  setLoadedFiles: (updater: LoadedRtonFile[] | ((files: LoadedRtonFile[]) => LoadedRtonFile[])) => void;
  tabs: EditorTab[];
  t: Translator;
  updateStatus: (message: string, tone?: Tone) => void;
  viewModeRef: { current: ViewMode };
  wasmReady: boolean;
}) {
  const loadRtonEntries = useCallback(
    async (entries: RtonLoadEntry[]) => {
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
      const { preferredEditorSurface, preferredViewMode } = getPreferredPreview({
        activeTabId,
        editorSurface,
        previewPreference,
        viewMode: viewModeRef.current,
      });
      for (const entry of candidates) {
        try {
          const decoded = await decodeLoadableSource(entry, preferredViewMode, preferredEditorSurface, t);
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
    },
    [
      activeTabId,
      editorSurface,
      nextTabId,
      openEditorTabs,
      previewPreference,
      renderTextForValue,
      t,
      updateStatus,
      viewModeRef,
      wasmReady,
    ],
  );

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
    [nextLoadedFileId, setLoadedFiles, t, updateStatus],
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
        const { preferredEditorSurface, preferredViewMode } = getPreferredPreview({
          activeTabId,
          editorSurface,
          previewPreference,
          viewMode: viewModeRef.current,
        });
        const decoded = await decodeLoadableSource(entry, preferredViewMode, preferredEditorSurface, t);
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
    [
      activateEditorTab,
      activeTabId,
      editorSurface,
      loadedFiles,
      nextTabId,
      openEditorTabs,
      previewPreference,
      renderTextForValue,
      setLoadedFiles,
      t,
      tabs,
      updateStatus,
      viewModeRef,
      wasmReady,
    ],
  );

  const loadRtonFiles = useCallback(
    async (files: File[]) => {
      await loadRtonEntries(files.map((file) => ({ file, path: displayFilePath(file) })));
    },
    [loadRtonEntries],
  );

  const loadRtonFolder = useCallback(async () => {
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
  }, [stageRtonEntries, t, updateStatus]);

  return {
    loadRtonEntries,
    loadRtonFiles,
    loadRtonFolder,
    openLoadedFile,
    stageRtonEntries,
  };
}

function getPreferredPreview({
  activeTabId,
  editorSurface,
  previewPreference,
  viewMode,
}: {
  activeTabId: number | null;
  editorSurface: EditorSurface;
  previewPreference: PreviewPreference;
  viewMode: ViewMode;
}) {
  const effectivePreference: PreviewPreference = activeTabId === null
    ? previewPreference
    : editorSurface === 'hex'
      ? 'rton'
      : viewMode;

  return {
    preferredEditorSurface: effectivePreference === 'rton' ? 'hex' : 'text',
    preferredViewMode: effectivePreference === 'rton' ? viewMode : effectivePreference,
  } satisfies { preferredEditorSurface: EditorSurface; preferredViewMode: ViewMode };
}

function errorMessage(error: unknown) {
  return error instanceof Error ? error.message : String(error);
}

function isDirectoryPickerGestureError(error: unknown) {
  return errorMessage(error).toLowerCase().includes('user gesture');
}
