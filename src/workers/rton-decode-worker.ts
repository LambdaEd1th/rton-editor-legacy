import { collectStats, RTON_SEARCH_MATCH_LIMIT, type Stats } from '../domain/rton-value-analysis';
import { decodeRtonValueWire, encodeRtonValueWire, type RtonValue } from '../domain/rton-value';
import {
  previewRtonValue,
  type RtonValuePath,
  type SearchMatch,
} from '../domain/rton-value-editing';
import { locateRtonValueOffset } from '../domain/rton-offset-map';
import type { RemoteRtonValueNode, RtonDocumentRef } from '../domain/rton-document';
import init, {
  decode_rton_to_value,
  decrypt_rton_data,
  value_to_json_text,
} from '../wasm/rton-editor/rton_editor_wasm';

type StructuredTextMode = 'yaml' | 'toml';
type RtonDocumentTextMode = 'json' | StructuredTextMode;

type RtonDecodeRequest =
  | {
      action: 'decode';
      id: number;
      bytes: Uint8Array;
      includeValue: boolean;
      retainDocument: boolean;
    }
  | {
      action: 'children';
      id: number;
      documentId: number;
      path: RtonValuePath;
      offset: number;
      limit: number;
    }
  | {
      action: 'search';
      id: number;
      documentId: number;
      query: string;
      limit: number;
    }
  | {
      action: 'locate';
      id: number;
      documentId: number;
      path: RtonValuePath;
    }
  | {
      action: 'exportText';
      id: number;
      documentId: number;
      mode: RtonDocumentTextMode;
    }
  | {
      action: 'replaceDocumentBytes';
      id: number;
      documentId: number;
      bytes: Uint8Array;
    }
  | {
      action: 'release';
      id: number;
      documentId: number;
    };

type RtonDecodeResponse =
  | {
      action: 'decode';
      id: number;
      ok: true;
      value?: RtonValue;
      document?: RtonDocumentRef;
      stats: Stats;
      plainBytes: Uint8Array;
      compact: boolean;
      encrypted: boolean;
      elapsedMs: number;
    }
  | {
      action: 'children';
      id: number;
      ok: true;
      nodes: RemoteRtonValueNode[];
      total: number;
    }
  | {
      action: 'search';
      id: number;
      ok: true;
      query: string;
      matches: SearchMatch[];
      scanned: number;
      done: boolean;
      capped: boolean;
    }
  | {
      action: 'locate';
      id: number;
      ok: true;
      offset: number | null;
    }
  | {
      action: 'exportText';
      id: number;
      ok: true;
      bytes: Uint8Array;
    }
  | {
      action: 'replaceDocumentBytes';
      id: number;
      ok: true;
      document: RtonDocumentRef;
      stats: Stats;
      plainBytes: Uint8Array;
      compact: boolean;
      encrypted: boolean;
      elapsedMs: number;
    }
  | {
      action: 'release';
      id: number;
      ok: true;
    }
  | {
      action: RtonDecodeRequest['action'];
      id: number;
      ok: false;
      error: string;
    };

type StoredRtonDocument = {
  value: RtonValue;
  bytes: Uint8Array;
  stats: Stats;
  byteLength: number;
  version: number;
};

let wasmReady: Promise<void> | null = null;
let nextDocumentId = 1;
const documents = new Map<number, StoredRtonDocument>();

self.addEventListener('message', (event: MessageEvent<RtonDecodeRequest>) => {
  void handleRequest(event.data);
});

async function handleRequest(request: RtonDecodeRequest) {
  try {
    if (request.action === 'decode') {
      await handleDecodeRequest(request);
    } else if (request.action === 'children') {
      handleChildrenRequest(request);
    } else if (request.action === 'search') {
      handleSearchRequest(request);
    } else if (request.action === 'locate') {
      handleLocateRequest(request);
    } else if (request.action === 'exportText') {
      await handleExportTextRequest(request);
    } else if (request.action === 'replaceDocumentBytes') {
      await handleReplaceDocumentBytesRequest(request);
    } else {
      handleReleaseRequest(request);
    }
  } catch (error) {
    postWorkerMessage({
      action: request.action,
      id: request.id,
      ok: false,
      error: errorMessage(error),
    });
  }
}

async function handleDecodeRequest(request: Extract<RtonDecodeRequest, { action: 'decode' }>) {
  await ensureWasmReady();
  const startedAt = performance.now();
  const { value, stats, plainBytes, compact, encrypted } = decodeBytesToDocumentData(request.bytes);
  const document = request.retainDocument ? storeDocument(value, plainBytes, stats) : undefined;
  const outgoingBytes = request.retainDocument ? new Uint8Array(plainBytes) : plainBytes;
  const response: RtonDecodeResponse = {
    action: 'decode',
    id: request.id,
    ok: true,
    value: request.includeValue ? value : undefined,
    document,
    stats,
    plainBytes: outgoingBytes,
    compact,
    encrypted,
    elapsedMs: performance.now() - startedAt,
  };
  postWorkerMessage(response, [outgoingBytes.buffer as ArrayBuffer]);
}

function handleChildrenRequest(request: Extract<RtonDecodeRequest, { action: 'children' }>) {
  const document = requireDocument(request.documentId);
  const value = requireValueAtPath(document.value, request.path);
  const total = childCount(value);
  const nodes = summarizeChildren(value, request.path, request.offset, request.limit);
  postWorkerMessage({
    action: 'children',
    id: request.id,
    ok: true,
    nodes,
    total,
  });
}

function handleSearchRequest(request: Extract<RtonDecodeRequest, { action: 'search' }>) {
  const document = requireDocument(request.documentId);
  const result = searchDocument(document.value, request.query.trim().toLowerCase(), Math.min(request.limit, RTON_SEARCH_MATCH_LIMIT));
  postWorkerMessage({
    action: 'search',
    id: request.id,
    ok: true,
    query: request.query,
    ...result,
  });
}

function handleLocateRequest(request: Extract<RtonDecodeRequest, { action: 'locate' }>) {
  const document = requireDocument(request.documentId);
  postWorkerMessage({
    action: 'locate',
    id: request.id,
    ok: true,
    offset: locateRtonValueOffset(document.bytes, request.path),
  });
}

async function handleExportTextRequest(request: Extract<RtonDecodeRequest, { action: 'exportText' }>) {
  const document = requireDocument(request.documentId);
  const text = await formatDocumentText(document.value, request.mode);
  const bytes = new TextEncoder().encode(text);
  postWorkerMessage({
    action: 'exportText',
    id: request.id,
    ok: true,
    bytes,
  }, [bytes.buffer as ArrayBuffer]);
}

async function handleReplaceDocumentBytesRequest(request: Extract<RtonDecodeRequest, { action: 'replaceDocumentBytes' }>) {
  await ensureWasmReady();
  const startedAt = performance.now();
  const { value, stats, plainBytes, compact, encrypted } = decodeBytesToDocumentData(request.bytes);
  const storedBytes = new Uint8Array(plainBytes);
  documents.set(request.documentId, {
    value,
    bytes: storedBytes,
    stats,
    byteLength: storedBytes.byteLength,
    version: (documents.get(request.documentId)?.version ?? 0) + 1,
  });
  const version = documents.get(request.documentId)?.version ?? 1;
  const document: RtonDocumentRef = {
    id: request.documentId,
    version,
    root: summarizeNode('$', value, []),
    stats,
    byteLength: storedBytes.byteLength,
  };
  const outgoingBytes = new Uint8Array(plainBytes);
  postWorkerMessage({
    action: 'replaceDocumentBytes',
    id: request.id,
    ok: true,
    document,
    stats,
    plainBytes: outgoingBytes,
    compact,
    encrypted,
    elapsedMs: performance.now() - startedAt,
  }, [outgoingBytes.buffer as ArrayBuffer]);
}

function handleReleaseRequest(request: Extract<RtonDecodeRequest, { action: 'release' }>) {
  documents.delete(request.documentId);
  postWorkerMessage({
    action: 'release',
    id: request.id,
    ok: true,
  });
}

async function ensureWasmReady() {
  if (!wasmReady) {
    wasmReady = init().then(() => undefined);
  }
  await wasmReady;
}

function storeDocument(value: RtonValue, bytes: Uint8Array, stats: Stats): RtonDocumentRef {
  const id = nextDocumentId;
  nextDocumentId += 1;
  const storedBytes = new Uint8Array(bytes);
  documents.set(id, {
    value,
    bytes: storedBytes,
    stats,
    byteLength: storedBytes.byteLength,
    version: 1,
  });
  return {
    id,
    version: 1,
    root: summarizeNode('$', value, []),
    stats,
    byteLength: storedBytes.byteLength,
  };
}

function decodeBytesToDocumentData(bytes: Uint8Array) {
  const encrypted = isEncryptedRtonBytes(bytes);
  const plainBytes = encrypted ? decrypt_rton_data(bytes) : bytes;
  const compact = isCompactRtonBytes(plainBytes);
  const wire = decode_rton_to_value(plainBytes);
  const value = decodeRtonValueWire(wire);
  const stats = collectStats(value);
  return { value, stats, plainBytes, compact, encrypted };
}

async function formatDocumentText(value: RtonValue, mode: RtonDocumentTextMode) {
  if (mode === 'json') {
    return value_to_json_text(encodeRtonValueWire(value), true);
  }

  const { formatStructuredText } = await import('../domain/format-conversion');
  return formatStructuredText(value, mode);
}

function requireDocument(id: number) {
  const document = documents.get(id);
  if (!document) {
    throw new Error(`RTON document ${id} is no longer available.`);
  }
  return document;
}

function requireValueAtPath(root: RtonValue, path: RtonValuePath) {
  let value = root;
  for (const segment of path) {
    if (segment.kind === 'array') {
      if (value.kind !== 'array' || segment.index < 0 || segment.index >= value.items.length) {
        throw new Error('RTON document path is stale.');
      }
      value = value.items[segment.index];
    } else {
      if (value.kind !== 'object' || segment.index < 0 || segment.index >= value.entries.length) {
        throw new Error('RTON document path is stale.');
      }
      value = value.entries[segment.index].value;
    }
  }
  return value;
}

function summarizeChildren(value: RtonValue, path: RtonValuePath, offset: number, limit: number) {
  const safeOffset = Math.max(0, Math.floor(offset));
  const safeLimit = Math.max(0, Math.floor(limit));
  if (safeLimit === 0) {
    return [];
  }

  if (value.kind === 'array') {
    const end = Math.min(value.items.length, safeOffset + safeLimit);
    const nodes: RemoteRtonValueNode[] = [];
    for (let index = safeOffset; index < end; index += 1) {
      nodes.push(summarizeNode(`[${index}]`, value.items[index], [...path, { kind: 'array', index }]));
    }
    return nodes;
  }

  if (value.kind === 'object') {
    const end = Math.min(value.entries.length, safeOffset + safeLimit);
    const nodes: RemoteRtonValueNode[] = [];
    for (let index = safeOffset; index < end; index += 1) {
      const entry = value.entries[index];
      nodes.push(summarizeNode(entry.key, entry.value, [...path, { kind: 'object', index }]));
    }
    return nodes;
  }

  return [];
}

function summarizeNode(label: string, value: RtonValue, path: RtonValuePath): RemoteRtonValueNode {
  return {
    label,
    kind: value.kind,
    preview: previewRtonValue(value),
    childCount: childCount(value),
    path,
  };
}

function childCount(value: RtonValue) {
  if (value.kind === 'array') {
    return value.items.length;
  }
  if (value.kind === 'object') {
    return value.entries.length;
  }
  return 0;
}

function searchDocument(value: RtonValue, query: string, limit: number) {
  const matches: SearchMatch[] = [];
  const stack: Array<{ value: RtonValue; path: string; valuePath: RtonValuePath }> = [{ value, path: '$', valuePath: [] }];
  let scanned = 0;

  while (stack.length > 0 && matches.length < limit) {
    const frame = stack.pop();
    if (!frame) {
      continue;
    }

    scanned += 1;
    const preview = previewRtonValue(frame.value);
    if (!query || frame.path.toLowerCase().includes(query) || preview.toLowerCase().includes(query)) {
      matches.push({ path: frame.path, preview, valuePath: frame.valuePath });
    }

    if (frame.value.kind === 'array') {
      for (let index = frame.value.items.length - 1; index >= 0; index -= 1) {
        stack.push({
          value: frame.value.items[index],
          path: `${frame.path}[${index}]`,
          valuePath: [...frame.valuePath, { kind: 'array', index }],
        });
      }
    } else if (frame.value.kind === 'object') {
      for (let index = frame.value.entries.length - 1; index >= 0; index -= 1) {
        const entry = frame.value.entries[index];
        stack.push({
          value: entry.value,
          path: childPath(frame.path, entry.key),
          valuePath: [...frame.valuePath, { kind: 'object', index }],
        });
      }
    }
  }

  return {
    matches,
    scanned,
    done: stack.length === 0,
    capped: matches.length >= limit && stack.length > 0,
  };
}

function childPath(parent: string, key: string) {
  return /^[A-Za-z_$][\w$]*$/.test(key) ? `${parent}.${key}` : `${parent}[${JSON.stringify(key)}]`;
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
