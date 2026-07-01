import { useCallback } from 'react';
import {
  createEditorTabFromBytes,
  createEditorTabFromDocument,
  createEditorTabFromValue,
  type EditorTab,
} from '../workspace/editor-tabs';
import {
  collectDirectoryEntries,
  collectLoadableCandidates,
  displayFilePath,
  loadableFileKindLabel,
  LOADABLE_FILE_HINT,
  normalizeDisplayPath,
  type DirectoryPickerWindow,
  type LoadableFileCandidate,
  type RtonLoadEntry,
} from '../files/file-loading';
import type { LoadedRtonFile } from '../files/loaded-file-items';
import type { Translator } from '../localization/i18n';
import type { PreviewPreference } from '../workspace/preferences';
import {
  isCompactRtonBytes,
  isEncryptedRtonBytes,
  isPendingTextPreview,
  type EditorSurface,
  type DecodedLoadableSource,
  type Tone,
  type ViewMode,
} from '../domain/rton-codec';
import type { RtonValue } from '../domain/rton-value';
import { RTON_LARGE_DOCUMENT_THRESHOLD_BYTES } from '../domain/rton-document';
import type { RtonDecodeWorkerOutput, TextParseWorkerOutput } from './worker-clients';

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
  runRtonDecodeFileInWorker,
  runTextParseInWorker,
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
  runRtonDecodeFileInWorker: (file: File, options?: { includeValue?: boolean; retainDocument?: boolean; includeBytes?: boolean }) => Promise<RtonDecodeWorkerOutput>;
  runTextParseInWorker: (text: string, mode: ViewMode) => Promise<TextParseWorkerOutput>;
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
          const decoded = await decodeLoadableEntry(
            entry,
            preferredViewMode,
            preferredEditorSurface,
            t,
            runRtonDecodeFileInWorker,
            runTextParseInWorker,
          );
          loadedTabs.push(
            createEditorTabFromDecodedSource({
              id: nextTabId.current,
              fileName: normalizeDisplayPath(entry.path),
              decoded,
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
      runRtonDecodeFileInWorker,
      runTextParseInWorker,
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
        const decoded = await decodeLoadableEntry(
          entry,
          preferredViewMode,
          preferredEditorSurface,
          t,
          runRtonDecodeFileInWorker,
          runTextParseInWorker,
        );
        const tabId = nextTabId.current;
        const tab = createEditorTabFromDecodedSource({
          id: tabId,
          fileName: entry.path,
          decoded,
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
      runRtonDecodeFileInWorker,
      runTextParseInWorker,
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

async function decodeLoadableEntry(
  entry: LoadableFileCandidate,
  preferredViewMode: ViewMode,
  preferredEditorSurface: EditorSurface,
  t: Translator,
  runRtonDecodeFileInWorker: (file: File, options?: { includeValue?: boolean; retainDocument?: boolean; includeBytes?: boolean }) => Promise<RtonDecodeWorkerOutput>,
  runTextParseInWorker: (text: string, mode: ViewMode) => Promise<TextParseWorkerOutput>,
): Promise<DecodedLoadableSource> {
  if (entry.kind !== 'rton') {
    const text = await entry.file.text();
    const mode = entry.kind;
    const { value, stats } = await runTextParseInWorker(text, mode);
    const label = loadableFileKindLabel(mode);
    return {
      value,
      editorText: text,
      surfaceNote: t('format.editable', { label }),
      sourceBytes: null,
      binaryBytes: null,
      binaryEncoding: null,
      viewMode: mode,
      editorSurface: 'text',
      status: { message: t('format.parsed', { label }), tone: 'ok' },
      stats,
      parsedJson: null,
    };
  }

  const largeDocument = entry.file.size >= RTON_LARGE_DOCUMENT_THRESHOLD_BYTES;
  if (largeDocument) {
    const headerBytes = await readFileHeader(entry.file);
    const encrypted = isEncryptedRtonBytes(headerBytes);
    const binaryEncoding = { compact: encrypted ? false : isCompactRtonBytes(headerBytes), encrypted };
    return {
      value: null,
      rtonDocument: null,
      editorText: '',
      surfaceNote: t('format.largeDocumentIndexing'),
      sourceBytes: null,
      binaryBytes: null,
      hexByteSource: {
        kind: 'file',
        file: entry.file,
        byteLength: entry.file.size,
        binaryEncoding,
      },
      binaryEncoding,
      viewMode: preferredViewMode,
      editorSurface: 'hex',
      status: { message: t('status.largeRtonOpened'), tone: 'ok' },
      parsedJson: null,
      needsTextPreview: false,
    };
  }

  const { value, document, stats, plainBytes, compact, encrypted } = await runRtonDecodeFileInWorker(entry.file, {
    includeValue: true,
    retainDocument: false,
    includeBytes: true,
  });
  const useHexSurface = largeDocument || preferredEditorSurface === 'hex';
  const label = loadableFileKindLabel(preferredViewMode);
  const editorText = useHexSurface ? '' : t('format.generatingPreviewText', { label });
  const textSurfaceNote = useHexSurface ? t('app.notGenerated') : t('format.generatingPreview', { label });

  return {
    value,
    rtonDocument: document,
    editorText,
    surfaceNote: largeDocument ? t('format.largeDocumentMode') : useHexSurface ? t('format.rtonEditable') : textSurfaceNote,
    sourceBytes: plainBytes,
    binaryBytes: plainBytes,
    binaryEncoding: { compact, encrypted: false },
    viewMode: preferredViewMode,
    editorSurface: useHexSurface ? 'hex' : 'text',
    status: {
      message: encrypted ? t('status.encryptedRtonParsed') : t('format.parsed', { label: 'RTON' }),
      tone: 'ok',
    },
    stats,
    parsedJson: null,
    needsTextPreview: Boolean(value) && !useHexSurface,
  };
}

function createEditorTabFromDecodedSource({
  id,
  fileName,
  decoded,
}: {
  id: number;
  fileName: string;
  decoded: DecodedLoadableSource;
}) {
  if (decoded.rtonDocument && !decoded.value) {
    return createEditorTabFromDocument({
      id,
      fileName,
      document: decoded.rtonDocument,
      editorText: decoded.editorText,
      surfaceNote: decoded.surfaceNote,
      sourceBytes: decoded.sourceBytes,
      binaryBytes: decoded.binaryBytes,
      hexByteSource: decoded.hexByteSource ?? null,
      binaryEncoding: decoded.binaryEncoding,
      viewMode: decoded.viewMode,
      editorSurface: decoded.editorSurface,
      status: decoded.status,
    });
  }

  if (!decoded.value) {
    return createEditorTabFromBytes({
      id,
      fileName,
      editorText: decoded.editorText,
      surfaceNote: decoded.surfaceNote,
      sourceBytes: decoded.sourceBytes,
      binaryBytes: decoded.binaryBytes,
      hexByteSource: decoded.hexByteSource ?? null,
      binaryEncoding: decoded.binaryEncoding,
      viewMode: decoded.viewMode,
      editorSurface: decoded.editorSurface,
      status: decoded.status,
      stats: decoded.stats,
      searchState: { kind: 'message', message: decoded.surfaceNote },
    });
  }

  return createEditorTabFromValue({
    id,
    fileName,
    value: decoded.value,
    rtonDocument: decoded.rtonDocument ?? null,
    editorText: decoded.editorText,
    surfaceNote: decoded.surfaceNote,
    sourceBytes: decoded.sourceBytes,
    binaryBytes: decoded.binaryBytes,
    hexByteSource: decoded.hexByteSource ?? null,
    binaryEncoding: decoded.binaryEncoding,
    viewMode: decoded.viewMode,
    editorSurface: decoded.editorSurface,
    status: decoded.status,
    stats: decoded.stats,
    parsedJson: decoded.parsedJson,
  });
}

async function readFileHeader(file: File) {
  return new Uint8Array(await file.slice(0, Math.min(file.size, 16)).arrayBuffer());
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
