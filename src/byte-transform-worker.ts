import { encodeRtonValueWire, type RtonValue } from './rton-value';
import init, { encode_value_to_rton, encrypt_rton_data } from './wasm/rton-editor/rton_editor_wasm';

type ByteTransformTarget = {
  compact: boolean;
  encrypted: boolean;
};

type ByteTransformRequest = {
  id: number;
  target: ByteTransformTarget;
  value: RtonValue;
};

type ByteTransformResponse =
  | {
      id: number;
      target: ByteTransformTarget;
      ok: true;
      bytes: Uint8Array;
      elapsedMs: number;
    }
  | {
      id: number;
      target: ByteTransformTarget;
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
    const encoded = encode_value_to_rton(encodeRtonValueWire(request.value), request.target.compact);
    const bytes = request.target.encrypted ? encrypt_rton_data(encoded) : encoded;
    const response: ByteTransformResponse = {
      id: request.id,
      target: request.target,
      ok: true,
      bytes,
      elapsedMs: performance.now() - startedAt,
    };
    postWorkerMessage(response, [bytes.buffer as ArrayBuffer]);
  } catch (error) {
    const response: ByteTransformResponse = {
      id: request.id,
      target: request.target,
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
