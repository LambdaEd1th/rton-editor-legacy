import { useCallback, useRef } from 'react';
import {
  createBatchExportArchive,
  encodeBatchExportValue,
  resolveBatchExportItemValue,
  type BatchExportMode,
  type BatchExportResolvableItem,
} from '../files/batch-export';
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
import {
  formatRtonEncoding,
  rtonValueToJsonText,
  sameRtonEncoding,
  type EditorSurface,
  type RtonBinaryEncoding,
  type Tone,
  type ViewMode,
} from '../domain/rton-codec';
import type { RtonValue } from '../domain/rton-value';
import type { ByteTransformWorkerPayload } from './worker-clients';

type ExportListItem = BatchExportResolvableItem & {
  key: string;
};

export function useExportActions({
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
  runByteTransformSizeInWorker,
}: {
  activeTabId: number | null;
  binaryBytes: Uint8Array | null;
  binaryEncoding: RtonBinaryEncoding | null;
  compactOutput: boolean;
  currentValueRef: { current: RtonValue | null };
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
      if (editorSurface === 'hex' && binaryBytes) {
        const hexOutputMatchesSource = binaryEncoding !== null && sameRtonEncoding(binaryEncoding, targetBinaryEncoding);
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
    binaryEncoding,
    currentValueRef,
    editorSurface,
    parseError,
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
    fileName,
    parseError,
    runByteTransformInWorker,
    setLastOutputBytes,
    t,
    targetBinaryEncoding,
    updateStatus,
    wasmReady,
  ]);

  const downloadJson = useCallback(() => {
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
  }, [activeTabId, currentValueRef, fileName, parseError, t, updateStatus]);

  const downloadStructuredFormat = useCallback(
    async (mode: StructuredFormatMode) => {
      if (activeTabId === null) {
        updateStatus(t('status.openFileFirst'), 'warn');
        return;
      }

      try {
        const value = currentValueRef.current;
        if (!value) {
          throw new Error(parseError ?? t('status.noSearchableValue'));
        }
        const { formatStructuredText } = await import('../domain/format-conversion');
        const text = formatStructuredText(value, mode);
        downloadBlob(text, outputBaseName(fileName, mode), mode === 'yaml' ? 'application/yaml' : 'application/toml');
        updateStatus(t('format.generated', { label: mode.toUpperCase() }), 'ok');
      } catch (error) {
        updateStatus(errorMessage(error), 'error');
      }
    },
    [activeTabId, currentValueRef, fileName, parseError, t, updateStatus],
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
      const structuredFormatter =
        mode === 'yaml' || mode === 'toml' ? (await import('../domain/format-conversion')).formatStructuredText : null;

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
      currentValueRef,
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
