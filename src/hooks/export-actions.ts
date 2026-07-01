import { useCallback, useRef } from 'react';
import type { BatchExportMode, BatchExportResolvableItem } from '../files/batch-export';
import type { EditorTab } from '../workspace/editor-tabs';
import type { StructuredFormatMode } from '../domain/format-conversion';
import {
  downloadBlob,
  downloadBytes,
  formatBytes,
  outputBaseName,
  timestampForFileName,
} from '../files/file-export';
import type { LoadedRtonFile } from '../files/loaded-file-items';
import type { Translator } from '../localization/i18n';
import type { RtonDocumentRef } from '../domain/rton-document';
import {
  formatRtonEncoding,
  sameRtonEncoding,
  type EditorSurface,
  type RtonBinaryEncoding,
  type Tone,
  type ViewMode,
} from '../domain/rton-codec';
import type { RtonValue } from '../domain/rton-value';
import type { HexByteSource } from '../domain/hex-byte-source';
import type {
  BatchExportWorkerItem,
  BatchExportWorkerOutput,
  ByteTransformWorkerPayload,
  RtonDocumentTextMode,
} from './worker-clients';

type ExportListItem = BatchExportResolvableItem & {
  key: string;
};

export function useExportActions({
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
  runByteTransformInWorker,
  runByteTransformSizeInWorker,
  runBatchExportInWorker,
  runTextExportInWorker,
  exportRtonDocumentBytes,
  exportRtonDocumentSize,
  exportRtonDocumentText,
}: {
  activeTabId: number | null;
  binaryBytes: Uint8Array | null;
  binaryEncoding: RtonBinaryEncoding | null;
  compactOutput: boolean;
  currentValueRef: { current: RtonValue | null };
  hexByteSource: HexByteSource | null;
  rtonDocument: RtonDocumentRef | null;
  editorSurface: EditorSurface;
  encryptOutput: boolean;
  fileName: string;
  loadedFileItems: ExportListItem[];
  loadedFiles: LoadedRtonFile[];
  parseError: string | null;
  selectedFileKeys: Set<string>;
  setLastOutputBytes: (bytes: number | null) => void;
  tabs: EditorTab[];
  targetBinaryEncoding: RtonBinaryEncoding;
  t: Translator;
  updateStatus: (message: string, tone?: Tone) => void;
  viewModeRef: { current: ViewMode };
  wasmReady: boolean;
  runByteTransformInWorker: (payload: ByteTransformWorkerPayload) => Promise<Uint8Array>;
  runByteTransformSizeInWorker: (payload: ByteTransformWorkerPayload) => Promise<number>;
  runBatchExportInWorker: (input: {
    items: BatchExportWorkerItem[];
    mode: BatchExportMode;
    compact: boolean;
    encrypted: boolean;
  }) => Promise<BatchExportWorkerOutput>;
  runTextExportInWorker: (value: RtonValue, mode: RtonDocumentTextMode) => Promise<Uint8Array>;
  exportRtonDocumentBytes: (documentId: number, target: RtonBinaryEncoding) => Promise<Uint8Array>;
  exportRtonDocumentSize: (documentId: number, target: RtonBinaryEncoding) => Promise<number>;
  exportRtonDocumentText: (documentId: number, mode: RtonDocumentTextMode) => Promise<Uint8Array>;
}) {
  const outputSizeRequestId = useRef(0);

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
      if (editorSurface === 'hex' && (binaryBytes || hexByteSource || rtonDocument)) {
        const hexOutputMatchesSource = binaryEncoding !== null && sameRtonEncoding(binaryEncoding, targetBinaryEncoding);
        setLastOutputBytes(hexOutputMatchesSource ? binaryBytes?.byteLength ?? rtonDocument?.byteLength ?? hexByteSource?.byteLength ?? null : null);
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
    binaryEncoding,
    currentValueRef,
    editorSurface,
    hexByteSource,
    parseError,
    rtonDocument,
    setLastOutputBytes,
    t,
    targetBinaryEncoding,
    updateStatus,
    viewModeRef,
    wasmReady,
  ]);

  const refreshOutputBytesForOptions = useCallback(async (nextTargetBinaryEncoding = targetBinaryEncoding) => {
    outputSizeRequestId.current += 1;
    const requestId = outputSizeRequestId.current;
    setLastOutputBytes(null);

    if (activeTabId === null || !wasmReady) {
      return;
    }

    try {
      if (binaryBytes && binaryEncoding) {
        if (sameRtonEncoding(binaryEncoding, nextTargetBinaryEncoding)) {
          setLastOutputBytes(binaryBytes.byteLength);
          return;
        }

        updateStatus(t('status.generatingRtonSize', { encoding: formatRtonEncoding(nextTargetBinaryEncoding, t) }), 'warn');
        const byteLength = await runByteTransformSizeInWorker({
          kind: 'bytes',
          source: binaryEncoding,
          target: nextTargetBinaryEncoding,
          bytes: new Uint8Array(binaryBytes),
        });
        if (requestId === outputSizeRequestId.current) {
          setLastOutputBytes(byteLength);
          updateStatus(
            t('status.rtonSizeGenerated', {
              encoding: formatRtonEncoding(nextTargetBinaryEncoding, t),
              size: formatBytes(byteLength),
            }),
            'ok',
          );
        }
        return;
      }

      if (rtonDocument && !currentValueRef.current) {
        updateStatus(t('status.generatingRtonSize', { encoding: formatRtonEncoding(nextTargetBinaryEncoding, t) }), 'warn');
        const byteLength = await exportRtonDocumentSize(rtonDocument.id, nextTargetBinaryEncoding);
        if (requestId === outputSizeRequestId.current) {
          setLastOutputBytes(byteLength);
          updateStatus(
            t('status.rtonSizeGenerated', {
              encoding: formatRtonEncoding(nextTargetBinaryEncoding, t),
              size: formatBytes(byteLength),
            }),
            'ok',
          );
        }
        return;
      }

      if (hexByteSource && binaryEncoding && hexByteSource.kind === 'file') {
        if (sameRtonEncoding(binaryEncoding, nextTargetBinaryEncoding)) {
          setLastOutputBytes(hexByteSource.byteLength);
        }
        return;
      }

      const value = currentValueRef.current;
      if (!value) {
        return;
      }

      updateStatus(t('status.generatingRtonSize', { encoding: formatRtonEncoding(nextTargetBinaryEncoding, t) }), 'warn');
      const byteLength = await runByteTransformSizeInWorker({
        kind: 'value',
        target: nextTargetBinaryEncoding,
        value,
      });
      if (requestId === outputSizeRequestId.current) {
        setLastOutputBytes(byteLength);
        updateStatus(
          t('status.rtonSizeGenerated', {
            encoding: formatRtonEncoding(nextTargetBinaryEncoding, t),
            size: formatBytes(byteLength),
          }),
          'ok',
        );
      }
    } catch (error) {
      if (requestId === outputSizeRequestId.current && errorMessage(error) !== t('status.byteTransformCancelled')) {
        updateStatus(errorMessage(error), 'error');
      }
    }
  }, [
    activeTabId,
    binaryBytes,
    binaryEncoding,
    currentValueRef,
    exportRtonDocumentSize,
    hexByteSource,
    rtonDocument,
    runByteTransformSizeInWorker,
    setLastOutputBytes,
    t,
    targetBinaryEncoding,
    updateStatus,
    wasmReady,
  ]);

  const downloadRton = useCallback(async () => {
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

      if (rtonDocument && !currentValueRef.current) {
        updateStatus(t('status.generatingHex', { encoding: formatRtonEncoding(targetBinaryEncoding, t) }), 'warn');
        const outputBytes = await exportRtonDocumentBytes(rtonDocument.id, targetBinaryEncoding);
        setLastOutputBytes(outputBytes.byteLength);
        downloadBytes(outputBytes, outputBaseName(fileName, 'rton'));
        updateStatus(t('format.generated', { label: `${formatRtonEncoding(targetBinaryEncoding, t)} RTON` }), 'ok');
        return;
      }

      if (hexByteSource && binaryEncoding && hexByteSource.kind === 'file') {
        if (sameRtonEncoding(binaryEncoding, targetBinaryEncoding)) {
          setLastOutputBytes(hexByteSource.byteLength);
          downloadBlob(hexByteSource.file, outputBaseName(fileName, 'rton'), 'application/octet-stream');
        } else {
          updateStatus(t('status.generatingHex', { encoding: formatRtonEncoding(targetBinaryEncoding, t) }), 'warn');
          const outputBytes = await runByteTransformInWorker({
            kind: 'file',
            source: binaryEncoding,
            target: targetBinaryEncoding,
            file: hexByteSource.file,
          });
          setLastOutputBytes(outputBytes.byteLength);
          downloadBytes(outputBytes, outputBaseName(fileName, 'rton'));
        }
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
  }, [
    activeTabId,
    binaryBytes,
    binaryEncoding,
    currentValueRef,
    exportRtonDocumentBytes,
    fileName,
    hexByteSource,
    parseError,
    runByteTransformInWorker,
    setLastOutputBytes,
    rtonDocument,
    t,
    targetBinaryEncoding,
    updateStatus,
    wasmReady,
  ]);

  const downloadJson = useCallback(async () => {
    if (activeTabId === null) {
      updateStatus(t('status.openFileFirst'), 'warn');
      return;
    }

    try {
      const value = currentValueRef.current;
      if (!value && rtonDocument) {
        updateStatus(t('status.generatingTextExport', { label: 'JSON' }), 'warn');
        const bytes = await exportRtonDocumentText(rtonDocument.id, 'json');
        downloadBytes(bytes, outputBaseName(fileName, 'json'));
        updateStatus(t('format.generated', { label: 'JSON' }), 'ok');
        return;
      }
      if (!value) {
        throw new Error(parseError ?? t('status.noSearchableValue'));
      }
      updateStatus(t('status.generatingTextExport', { label: 'JSON' }), 'warn');
      const bytes = await runTextExportInWorker(value, 'json');
      downloadBytes(bytes, outputBaseName(fileName, 'json'));
      updateStatus(t('format.generated', { label: 'JSON' }), 'ok');
    } catch (error) {
      updateStatus(errorMessage(error), 'error');
    }
  }, [activeTabId, currentValueRef, exportRtonDocumentText, fileName, parseError, rtonDocument, runTextExportInWorker, t, updateStatus]);

  const downloadStructuredFormat = useCallback(
    async (mode: StructuredFormatMode) => {
      if (activeTabId === null) {
        updateStatus(t('status.openFileFirst'), 'warn');
        return;
      }

      try {
        const value = currentValueRef.current;
        if (!value && rtonDocument) {
          const label = mode.toUpperCase();
          updateStatus(t('status.generatingTextExport', { label }), 'warn');
          const bytes = await exportRtonDocumentText(rtonDocument.id, mode);
          downloadBytes(bytes, outputBaseName(fileName, mode));
          updateStatus(t('format.generated', { label }), 'ok');
          return;
        }
        if (!value) {
          throw new Error(parseError ?? t('status.noSearchableValue'));
        }
        updateStatus(t('status.generatingTextExport', { label: mode.toUpperCase() }), 'warn');
        const bytes = await runTextExportInWorker(value, mode);
        downloadBytes(bytes, outputBaseName(fileName, mode));
        updateStatus(t('format.generated', { label: mode.toUpperCase() }), 'ok');
      } catch (error) {
        updateStatus(errorMessage(error), 'error');
      }
    },
    [activeTabId, currentValueRef, exportRtonDocumentText, fileName, parseError, rtonDocument, runTextExportInWorker, t, updateStatus],
  );

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
      const earlyErrors: string[] = [];
      const workerItems: BatchExportWorkerItem[] = [];

      for (const item of selectedItems) {
        const tab = item.tabId === null ? null : tabsById.get(item.tabId) ?? null;
        const tabValue = item.tabId === activeTabId ? currentValueRef.current : tab?.currentValue ?? null;
        if (tabValue) {
          workerItems.push({ path: item.path, source: 'value', value: tabValue });
          continue;
        }

        if (tab?.hexByteSource?.kind === 'file') {
          workerItems.push({ path: item.path, source: 'file', file: tab.hexByteSource.file, kind: 'rton' });
          continue;
        }

        if (item.fileId !== null) {
          const file = filesById.get(item.fileId);
          if (file) {
            workerItems.push({ path: item.path, source: 'file', file: file.file, kind: file.kind });
            continue;
          }
        }

        earlyErrors.push(`${item.path}: ${t('status.noExportValue')}`);
      }

      if (workerItems.length === 0) {
        updateStatus(earlyErrors[0] ?? t('status.noBatchSuccess'), 'error');
        return;
      }

      try {
        const result = await runBatchExportInWorker({
          items: workerItems,
          mode,
          compact: compactOutput,
          encrypted: encryptOutput,
        });
        const errors = [...earlyErrors, ...result.errors];

        if (!result.zipBytes) {
          updateStatus(errors[0] ?? t('status.noBatchSuccess'), 'error');
          return;
        }

        downloadBytes(result.zipBytes, `rton-editor-legacy-${mode}-${timestampForFileName()}.zip`);
        const errorSuffix = errors.length > 0 ? t('status.batchFailureSuffix', { count: errors.length.toLocaleString() }) : '';
        updateStatus(
          t('status.batchExported', { count: result.exportedCount.toLocaleString(), format: mode.toUpperCase(), suffix: errorSuffix }),
          errors.length > 0 ? 'warn' : 'ok',
        );
      } catch (error) {
        updateStatus(errorMessage(error), 'error');
      }
    },
    [
      activeTabId,
      compactOutput,
      currentValueRef,
      encryptOutput,
      loadedFileItems,
      loadedFiles,
      runBatchExportInWorker,
      selectedFileKeys,
      t,
      tabs,
      updateStatus,
      wasmReady,
    ],
  );

  return {
    batchExportSelectedFiles,
    downloadJson,
    downloadRton,
    downloadStructuredFormat,
    refreshOutputBytesForOptions,
    validateValue,
  };
}

function errorMessage(error: unknown) {
  return error instanceof Error ? error.message : String(error);
}
