import { formatStructuredText } from '../domain/format-conversion';
import type { RtonValue } from '../domain/rton-value';
import {
  createBatchExportArchive,
  encodeBatchExportValue,
  type BatchExportMode,
  type BatchExportResolvableItem,
} from '../files/batch-export';
import type { LoadableFileKind } from '../files/file-loading';
import { decodeLoadableSource } from '../domain/rton-codec';
import init from '../wasm/rton-editor/rton_editor_wasm';

type BatchExportWorkerItem =
  | {
      path: string;
      source: 'file';
      file: File;
      kind: LoadableFileKind;
    }
  | {
      path: string;
      source: 'value';
      value: RtonValue;
    };

type BatchExportWorkerRequest = {
  id: number;
  items: BatchExportWorkerItem[];
  mode: BatchExportMode;
  compact: boolean;
  encrypted: boolean;
};

type BatchExportWorkerResponse =
  | {
      id: number;
      ok: true;
      kind: 'progress';
      completed: number;
      total: number;
    }
  | {
      id: number;
      ok: true;
      kind: 'result';
      exportedCount: number;
      errors: string[];
      zipBytes: Uint8Array | null;
    }
  | {
      id: number;
      ok: false;
      error: string;
    };

type WorkerArchiveItem = BatchExportResolvableItem & BatchExportWorkerItem;

let wasmReady: Promise<void> | null = null;

self.addEventListener('message', (event: MessageEvent<BatchExportWorkerRequest>) => {
  void handleRequest(event.data);
});

async function handleRequest(request: BatchExportWorkerRequest) {
  try {
    await ensureWasmReady();
    const result = await createBatchExportArchive<WorkerArchiveItem>({
      items: request.items.map((item) => ({ ...item, fileId: null, tabId: null })),
      mode: request.mode,
      resolveValue: resolveWorkerItemValue,
      encodeValue: (value, mode) =>
        encodeBatchExportValue(value, mode, {
          compact: request.compact,
          encrypted: request.encrypted,
          structuredFormatter: mode === 'yaml' || mode === 'toml' ? formatStructuredText : null,
        }),
      describeError: errorMessage,
      onProgress: (completed, total) => {
        postWorkerMessage({
          id: request.id,
          ok: true,
          kind: 'progress',
          completed,
          total,
        });
      },
    });

    postWorkerMessage({
      id: request.id,
      ok: true,
      kind: 'result',
      ...result,
    }, result.zipBytes ? [result.zipBytes.buffer as ArrayBuffer] : undefined);
  } catch (error) {
    postWorkerMessage({
      id: request.id,
      ok: false,
      error: errorMessage(error),
    });
  }
}

async function ensureWasmReady() {
  if (!wasmReady) {
    wasmReady = init().then(() => undefined);
  }
  await wasmReady;
}

async function resolveWorkerItemValue(item: WorkerArchiveItem) {
  if (item.source === 'value') {
    return item.value;
  }

  const decoded = await decodeLoadableSource({
    file: item.file,
    kind: item.kind,
    path: item.path,
  });
  if (!decoded.value) {
    throw new Error('No exportable value');
  }
  return decoded.value;
}

function errorMessage(error: unknown) {
  return error instanceof Error ? error.message : String(error);
}

function postWorkerMessage(message: BatchExportWorkerResponse, transfer?: Transferable[]) {
  (self as unknown as { postMessage: (message: BatchExportWorkerResponse, transfer?: Transferable[]) => void }).postMessage(message, transfer);
}
