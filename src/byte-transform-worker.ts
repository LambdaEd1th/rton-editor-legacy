import init, { decrypt_rton_data, encrypt_rton_data } from './wasm-pkg/rton_editor_wasm';

type ByteTransformAction = 'encrypt' | 'decrypt';

type ByteTransformRequest = {
  id: number;
  action: ByteTransformAction;
  bytes: Uint8Array;
};

type ByteTransformResponse =
  | {
      id: number;
      action: ByteTransformAction;
      ok: true;
      bytes: Uint8Array;
      elapsedMs: number;
    }
  | {
      id: number;
      action: ByteTransformAction;
      ok: false;
      error: string;
    };

let wasmReady: Promise<void> | null = null;

self.addEventListener('message', (event: MessageEvent<ByteTransformRequest>) => {
  void handleRequest(event.data);
});

async function handleRequest(request: ByteTransformRequest) {
  try {
    await ensureWasmReady();
    const startedAt = performance.now();
    const bytes = request.action === 'encrypt' ? encrypt_rton_data(request.bytes) : decrypt_rton_data(request.bytes);
    const response: ByteTransformResponse = {
      id: request.id,
      action: request.action,
      ok: true,
      bytes,
      elapsedMs: performance.now() - startedAt,
    };
    postWorkerMessage(response, [bytes.buffer as ArrayBuffer]);
  } catch (error) {
    const response: ByteTransformResponse = {
      id: request.id,
      action: request.action,
      ok: false,
      error: errorMessage(error),
    };
    postWorkerMessage(response);
  }
}

async function ensureWasmReady() {
  if (!wasmReady) {
    wasmReady = init().then(() => undefined);
  }
  await wasmReady;
}

function errorMessage(error: unknown) {
  return error instanceof Error ? error.message : String(error);
}

function postWorkerMessage(message: ByteTransformResponse, transfer?: Transferable[]) {
  (self as unknown as { postMessage: (message: ByteTransformResponse, transfer?: Transferable[]) => void }).postMessage(message, transfer);
}
