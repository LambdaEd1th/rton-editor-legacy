import { formatStructuredText, parseStructuredText, type StructuredFormatMode } from './format-conversion';
import { rtonValueToPlain, type RtonValue } from './rton-value';

type FormatMode = 'json' | StructuredFormatMode;
type ParseMode = StructuredFormatMode;

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
      plainValue: unknown;
    }
  | {
      action: 'format' | 'parse';
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

self.addEventListener('message', (event: MessageEvent<FormatRequest>) => {
  const request = event.data;
  const { id, mode } = request;

  try {
    const response = request.action === 'format' ? handleFormat(request) : handleParse(request);
    self.postMessage(response);
  } catch (error) {
    self.postMessage({
      action: request.action,
      id,
      mode,
      ok: false,
      error: errorMessage(error),
    });
  }
});

function handleFormat(request: Extract<FormatRequest, { action: 'format' }>): FormatResponse {
  const formatted = request.mode === 'json' ? formatJsonText(request.value) : formatStructuredText(request.value, request.mode);
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

function handleParse(request: Extract<FormatRequest, { action: 'parse' }>): FormatResponse {
  const { value, plainValue } = parseStructuredText(request.text, request.mode);

  return {
    action: 'parse',
    id: request.id,
    mode: request.mode,
    ok: true,
    value,
    plainValue,
  };
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
