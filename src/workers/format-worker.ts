import { formatStructuredText, parseStructuredText, type StructuredFormatMode } from '../domain/format-conversion';
import { collectStats, type Stats } from '../domain/rton-value-analysis';
import {
  decodeRtonValueWire,
  rtonValueToPlain,
  type RtonValue,
} from '../domain/rton-value';
import init, {
  json_text_to_value,
} from '../wasm/rton-editor/rton_editor_wasm';

type FormatMode = 'json' | StructuredFormatMode;
type ParseMode = FormatMode;

type FormatRequest =
  | {
      action: 'format';
      id: number;
      value: RtonValue;
      mode: FormatMode;
    }
  | {
      action: 'parse';
      id: number;
      mode: ParseMode;
      text: string;
    }
  | {
      action: 'exportText';
      id: number;
      value: RtonValue;
      mode: FormatMode;
    };

type FormatResponse =
  | {
      action: 'format';
      id: number;
      mode: FormatMode;
      ok: true;
      text: string;
      truncated: boolean;
    }
  | {
      action: 'parse';
      id: number;
      mode: ParseMode;
      ok: true;
      value: RtonValue;
      stats: Stats;
    }
  | {
      action: 'exportText';
      id: number;
      mode: FormatMode;
      ok: true;
      bytes: Uint8Array;
    }
  | {
      action: 'format' | 'parse' | 'exportText';
      id: number;
      mode: FormatMode;
      ok: false;
      error: string;
    };

type FormatSuccess = {
  id: number;
  mode: FormatMode;
  text: string;
  truncated: boolean;
};

const PREVIEW_LIMIT = 1_500_000;
const TRUNCATED_SUFFIX: Record<FormatMode, string> = {
  json: '',
  yaml: '\n\n# Preview truncated.',
  toml: '\n\n# Preview truncated.',
};
let wasmReady: Promise<void> | null = null;

self.addEventListener('message', (event: MessageEvent<FormatRequest>) => {
  void handleRequest(event.data);
});

async function handleRequest(request: FormatRequest) {
  const { id, mode } = request;
  try {
    const response = request.action === 'format'
      ? handleFormat(request)
      : request.action === 'parse'
        ? await handleParse(request)
        : handleExportText(request);
    if (response.ok && response.action === 'exportText') {
      postWorkerMessage(response, [response.bytes.buffer as ArrayBuffer]);
    } else {
      postWorkerMessage(response);
    }
  } catch (error) {
    postWorkerMessage({
      action: request.action,
      id,
      mode,
      ok: false,
      error: errorMessage(error),
    });
  }
}

function handleFormat(request: Extract<FormatRequest, { action: 'format' }>): FormatResponse {
  const formatted = formatText(request.value, request.mode);
  const truncated = formatted.length > PREVIEW_LIMIT;
  const text = truncated
    ? `${formatted.slice(0, PREVIEW_LIMIT)}${TRUNCATED_SUFFIX[request.mode]}`
    : formatted;

  return {
    action: 'format',
    id: request.id,
    mode: request.mode,
    ok: true,
    text,
    truncated,
  } satisfies FormatSuccess & { action: 'format'; ok: true };
}

async function handleParse(request: Extract<FormatRequest, { action: 'parse' }>): Promise<FormatResponse> {
  const value = request.mode === 'json'
    ? await parseJsonText(request.text)
    : parseStructuredText(request.text, request.mode).value;

  return {
    action: 'parse',
    id: request.id,
    mode: request.mode,
    ok: true,
    value,
    stats: collectStats(value),
  };
}

function handleExportText(request: Extract<FormatRequest, { action: 'exportText' }>): FormatResponse {
  const text = formatText(request.value, request.mode);
  const bytes = new TextEncoder().encode(text);
  return {
    action: 'exportText',
    id: request.id,
    mode: request.mode,
    ok: true,
    bytes,
  };
}

function formatText(value: RtonValue, mode: FormatMode) {
  return mode === 'json' ? formatJsonText(value) : formatStructuredText(value, mode);
}

async function parseJsonText(text: string) {
  await ensureWasmReady();
  return decodeRtonValueWire(json_text_to_value(text));
}

async function ensureWasmReady() {
  if (!wasmReady) {
    wasmReady = init().then(() => undefined);
  }
  await wasmReady;
}

function formatJsonText(value: RtonValue) {
  const plainValue = rtonValueToPlain(value);
  assertJsonCompatible(plainValue);
  return JSON.stringify(plainValue, null, 2);
}

function assertJsonCompatible(value: unknown) {
  if (typeof value === 'number') {
    if (!Number.isFinite(value)) {
      throw new Error(`JSON does not support non-finite number: ${String(value)}`);
    }
    return;
  }

  if (Array.isArray(value)) {
    value.forEach(assertJsonCompatible);
    return;
  }

  if (value && typeof value === 'object') {
    Object.values(value as Record<string, unknown>).forEach(assertJsonCompatible);
  }
}

function errorMessage(error: unknown) {
  return error instanceof Error ? error.message : String(error);
}

function postWorkerMessage(message: FormatResponse, transfer?: Transferable[]) {
  (self as unknown as { postMessage: (message: FormatResponse, transfer?: Transferable[]) => void }).postMessage(message, transfer);
}
