import { encodeRtonValueWire, type RtonValue } from '../domain/rton-value';
import init, {
  decode_rton_to_value,
  decrypt_rton_data,
  encode_value_to_rton,
  encrypt_rton_data,
} from '../wasm/rton-editor/rton_editor_wasm';

type ByteTransformTarget = {
  compact: boolean;
  encrypted: boolean;
};

type ByteTransformRequest =
  | {
      id: number;
      kind: 'value';
      target: ByteTransformTarget;
      value: RtonValue;
      result?: ByteTransformResultKind;
    }
  | {
      id: number;
      kind: 'bytes';
      source: ByteTransformTarget;
      target: ByteTransformTarget;
      bytes: Uint8Array;
      result?: ByteTransformResultKind;
    };

type ByteTransformResultKind = 'bytes' | 'size';

type ByteTransformResponse =
  | {
      id: number;
      target: ByteTransformTarget;
      ok: true;
      byteLength: number;
      bytes?: Uint8Array;
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
    const bytes = request.kind === 'bytes'
      ? transformRtonBytes(request.bytes, request.source, request.target)
      : transformRtonValue(request.value, request.target);
    const response: ByteTransformResponse = {
      id: request.id,
      target: request.target,
      ok: true,
      byteLength: bytes.byteLength,
      ...(request.result === 'size' ? {} : { bytes }),
      elapsedMs: performance.now() - startedAt,
    };
    postWorkerMessage(response, request.result === 'size' ? undefined : [bytes.buffer as ArrayBuffer]);
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

function transformRtonValue(value: RtonValue, target: ByteTransformTarget) {
  const encoded = encode_value_to_rton(encodeRtonValueWire(value), target.compact);
  return target.encrypted ? encrypt_rton_data(encoded) : encoded;
}

function transformRtonBytes(bytes: Uint8Array, source: ByteTransformTarget, target: ByteTransformTarget) {
  if (source.compact === target.compact && source.encrypted === target.encrypted) {
    return bytes;
  }

  const plainBytes = source.encrypted ? decrypt_rton_data(bytes) : bytes;
  if (source.compact === target.compact) {
    return target.encrypted ? encrypt_rton_data(plainBytes) : plainBytes;
  }

  const valueWire = decode_rton_to_value(plainBytes);
  const encoded = encode_value_to_rton(valueWire, target.compact);
  return target.encrypted ? encrypt_rton_data(encoded) : encoded;
}

function errorMessage(error: unknown) {
  return error instanceof Error ? error.message : String(error);
}

function postWorkerMessage(message: ByteTransformResponse, transfer?: Transferable[]) {
  (self as unknown as { postMessage: (message: ByteTransformResponse, transfer?: Transferable[]) => void }).postMessage(message, transfer);
}
