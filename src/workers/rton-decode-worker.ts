import { collectStats, type Stats } from '../domain/rton-value-analysis';
import { decodeRtonValueWire, type RtonValue } from '../domain/rton-value';
import init, {
  decode_rton_to_value,
  decrypt_rton_data,
} from '../wasm/rton-editor/rton_editor_wasm';

type RtonDecodeRequest = {
  id: number;
  bytes: Uint8Array;
};

type RtonDecodeResponse =
  | {
      id: number;
      ok: true;
      value: RtonValue;
      stats: Stats;
      plainBytes: Uint8Array;
      compact: boolean;
      encrypted: boolean;
      elapsedMs: number;
    }
  | {
      id: number;
      ok: false;
      error: string;
    };

let wasmReady: Promise<void> | null = null;

self.addEventListener('message', (event: MessageEvent<RtonDecodeRequest>) => {
  void handleRequest(event.data);
});

async function handleRequest(request: RtonDecodeRequest) {
  try {
    await ensureWasmReady();
    const startedAt = performance.now();
    const encrypted = isEncryptedRtonBytes(request.bytes);
    const plainBytes = encrypted ? decrypt_rton_data(request.bytes) : request.bytes;
    const compact = isCompactRtonBytes(plainBytes);
    const wire = decode_rton_to_value(plainBytes);
    const value = decodeRtonValueWire(wire);
    const response: RtonDecodeResponse = {
      id: request.id,
      ok: true,
      value,
      stats: collectStats(value),
      plainBytes,
      compact,
      encrypted,
      elapsedMs: performance.now() - startedAt,
    };
    postWorkerMessage(response, [plainBytes.buffer as ArrayBuffer]);
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

function isEncryptedRtonBytes(bytes: Uint8Array) {
  return bytes.length >= 2 && bytes[0] === 0x10 && bytes[1] === 0x00;
}

function isCompactRtonBytes(bytes: Uint8Array) {
  if (bytes.length < 9 || bytes[0] !== 0x52 || bytes[1] !== 0x54 || bytes[2] !== 0x4f || bytes[3] !== 0x4e) {
    return false;
  }
  const versionHigh = bytes[6] | (bytes[7] << 8);
  return versionHigh === 1 && bytes[8] === 0xb8;
}

function errorMessage(error: unknown) {
  return error instanceof Error ? error.message : String(error);
}

function postWorkerMessage(message: RtonDecodeResponse, transfer?: Transferable[]) {
  (self as unknown as { postMessage: (message: RtonDecodeResponse, transfer?: Transferable[]) => void }).postMessage(message, transfer);
}
