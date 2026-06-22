import { useCallback, useEffect, useRef } from 'react';
import type { Translator } from '../localization/i18n';
import type { Stats } from '../domain/rton-value-analysis';
import type { RtonValue } from '../domain/rton-value';
import type { RtonBinaryEncoding, ViewMode } from '../domain/rton-codec';
import type { RemoteRtonValueNode, RtonDocumentRef } from '../domain/rton-document';
import type { RtonValuePath, SearchMatch } from '../domain/rton-value-editing';

export type RtonDocumentTextMode = 'json' | 'yaml' | 'toml';

export type FormatWorkerAction = 'format' | 'parse';

export type FormatWorkerResponse =
  | {
      action: 'format';
      id: number;
      mode: ViewMode;
      ok: true;
      text: string;
      truncated: boolean;
    }
  | {
      action: 'parse';
      id: number;
      mode: Exclude<ViewMode, 'json'>;
      ok: true;
      value: RtonValue;
      plainValue: unknown;
    }
  | {
      action: FormatWorkerAction;
      id: number;
      mode: ViewMode;
      ok: false;
      error: string;
    };

export type ActiveFormatRequest = {
  action: FormatWorkerAction;
  id: number;
  mode: ViewMode;
};

export type FormatWorkerMessage =
  | {
      action: 'format';
      id: number;
      value: RtonValue;
      mode: ViewMode;
    }
  | {
      action: 'parse';
      id: number;
      mode: Exclude<ViewMode, 'json'>;
      text: string;
    };

export type ByteTransformWorkerPayload =
  | {
      kind: 'value';
      target: RtonBinaryEncoding;
      value: RtonValue;
      result?: ByteTransformResultKind;
    }
  | {
      kind: 'bytes';
      source: RtonBinaryEncoding;
      target: RtonBinaryEncoding;
      bytes: Uint8Array;
      result?: ByteTransformResultKind;
    };

type ByteTransformResultKind = 'bytes' | 'size';

type ByteTransformWorkerOutput = {
  byteLength: number;
  bytes: Uint8Array | null;
};

type ByteTransformWorkerRequest =
  | ({
      id: number;
    } & ByteTransformWorkerPayload);

type ByteTransformWorkerResponse =
  | {
      id: number;
      ok: true;
      byteLength: number;
      bytes?: Uint8Array;
    }
  | {
      id: number;
      ok: false;
      error: string;
    };

type PendingByteTransform = {
  resolve: (output: ByteTransformWorkerOutput) => void;
  reject: (error: Error) => void;
};

export type RtonDecodeWorkerOutput = {
  value: RtonValue | null;
  document: RtonDocumentRef | null;
  stats: Stats;
  plainBytes: Uint8Array;
  compact: boolean;
  encrypted: boolean;
};

export type RtonDocumentChildrenOutput = {
  nodes: RemoteRtonValueNode[];
  total: number;
};

export type RtonDocumentSearchOutput = {
  query: string;
  matches: SearchMatch[];
  scanned: number;
  done: boolean;
  capped: boolean;
};

export type RtonDocumentByteUpdateOutput = {
  document: RtonDocumentRef;
  stats: Stats;
  plainBytes: Uint8Array;
  compact: boolean;
  encrypted: boolean;
};

type RtonDecodeWorkerRequest =
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

type RtonDecodeWorkerResponse =
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
      action: RtonDecodeWorkerRequest['action'];
      id: number;
      ok: false;
      error: string;
    };

type PendingRtonDecode = {
  resolve: (
    output:
      | RtonDecodeWorkerOutput
      | RtonDocumentChildrenOutput
      | RtonDocumentSearchOutput
      | RtonDocumentByteUpdateOutput
      | Uint8Array
      | number
      | null
  ) => void;
  reject: (error: Error) => void;
};

export function useFormatWorkerClient({
  t,
  viewModeRef,
  timeoutMs,
  onResponse,
  onFailure,
}: {
  t: Translator;
  viewModeRef: { current: ViewMode };
  timeoutMs: number;
  onResponse: (response: FormatWorkerResponse) => void;
  onFailure: (message: string, request: ActiveFormatRequest | null) => void;
}) {
  const formatTimeout = useRef<number | null>(null);
  const formatWorker = useRef<Worker | null>(null);
  const activeFormatRequest = useRef<ActiveFormatRequest | null>(null);
  const formatRequestId = useRef(0);
  const onResponseRef = useRef(onResponse);
  const onFailureRef = useRef(onFailure);

  useEffect(() => {
    onResponseRef.current = onResponse;
    onFailureRef.current = onFailure;
  }, [onFailure, onResponse]);

  const clearFormatTimeout = useCallback(() => {
    if (formatTimeout.current !== null) {
      window.clearTimeout(formatTimeout.current);
      formatTimeout.current = null;
    }
  }, []);

  const terminateFormatWorker = useCallback(() => {
    clearFormatTimeout();
    activeFormatRequest.current = null;
    if (formatWorker.current) {
      formatWorker.current.terminate();
      formatWorker.current = null;
    }
  }, [clearFormatTimeout]);

  const failActiveRequest = useCallback(
    (message: string) => {
      const request = activeFormatRequest.current;
      terminateFormatWorker();
      onFailureRef.current(message, request);
    },
    [terminateFormatWorker],
  );

  const beginFormatWorkerRequest = useCallback(
    (action: FormatWorkerAction, mode: ViewMode) => {
      terminateFormatWorker();
      formatRequestId.current += 1;
      activeFormatRequest.current = { action, id: formatRequestId.current, mode };
      return formatRequestId.current;
    },
    [terminateFormatWorker],
  );

  const invalidateFormatWork = useCallback(() => {
    formatRequestId.current += 1;
    terminateFormatWorker();
  }, [terminateFormatWorker]);

  const scheduleFormatWorkerTimeout = useCallback(
    (requestId: number, mode: ViewMode, action: FormatWorkerAction) => {
      clearFormatTimeout();
      formatTimeout.current = window.setTimeout(() => {
        const currentRequest = activeFormatRequest.current;
        if (
          !currentRequest ||
          currentRequest.id !== requestId ||
          currentRequest.mode !== mode ||
          currentRequest.action !== action ||
          requestId !== formatRequestId.current ||
          mode !== viewModeRef.current
        ) {
          return;
        }

        const label = mode.toUpperCase();
        failActiveRequest(t(action === 'format' ? 'format.formatTimeout' : 'format.parseTimeout', { label }));
      }, timeoutMs);
    },
    [clearFormatTimeout, failActiveRequest, t, timeoutMs, viewModeRef],
  );

  const getFormatWorker = useCallback(() => {
    if (!formatWorker.current) {
      formatWorker.current = new Worker(new URL('../workers/format-worker.ts', import.meta.url), { type: 'module' });
      formatWorker.current.addEventListener('message', (event: MessageEvent<FormatWorkerResponse>) => {
        const response = event.data;
        if (response.id !== formatRequestId.current || response.mode !== viewModeRef.current) {
          return;
        }

        clearFormatTimeout();
        activeFormatRequest.current = null;
        onResponseRef.current(response);
      });
      formatWorker.current.addEventListener('error', (event) => {
        event.preventDefault();
        failActiveRequest(event instanceof ErrorEvent && event.message ? event.message : t('status.formatWorkerError'));
      });
      formatWorker.current.addEventListener('messageerror', () => {
        failActiveRequest(t('status.formatWorkerUnreadable'));
      });
    }

    return formatWorker.current;
  }, [clearFormatTimeout, failActiveRequest, t, viewModeRef]);

  const postFormatWorkerMessage = useCallback(
    (message: FormatWorkerMessage) => {
      getFormatWorker().postMessage(message);
    },
    [getFormatWorker],
  );

  useEffect(() => terminateFormatWorker, [terminateFormatWorker]);

  return {
    beginFormatWorkerRequest,
    invalidateFormatWork,
    postFormatWorkerMessage,
    scheduleFormatWorkerTimeout,
    terminateFormatWorker,
  };
}

export function useByteTransformWorker({
  t,
  onError,
}: {
  t: Translator;
  onError: (message: string) => void;
}) {
  const byteTransformWorker = useRef<Worker | null>(null);
  const byteTransformRequestId = useRef(0);
  const byteTransformPromises = useRef(new Map<number, PendingByteTransform>());
  const onErrorRef = useRef(onError);

  useEffect(() => {
    onErrorRef.current = onError;
  }, [onError]);

  const rejectPendingByteTransforms = useCallback((message: string) => {
    for (const pending of byteTransformPromises.current.values()) {
      pending.reject(new Error(message));
    }
    byteTransformPromises.current.clear();
  }, []);

  const terminateByteTransformWorker = useCallback(() => {
    byteTransformRequestId.current += 1;
    rejectPendingByteTransforms(t('status.byteTransformCancelled'));
    if (byteTransformWorker.current) {
      byteTransformWorker.current.terminate();
      byteTransformWorker.current = null;
    }
  }, [rejectPendingByteTransforms, t]);

  const getByteTransformWorker = useCallback(() => {
    if (!byteTransformWorker.current) {
      byteTransformWorker.current = new Worker(new URL('../workers/byte-transform-worker.ts', import.meta.url), { type: 'module' });
      byteTransformWorker.current.addEventListener('message', (event: MessageEvent<ByteTransformWorkerResponse>) => {
        const response = event.data;
        const pending = byteTransformPromises.current.get(response.id);
        if (pending) {
          byteTransformPromises.current.delete(response.id);
          if (response.ok) {
            pending.resolve({ byteLength: response.byteLength, bytes: response.bytes ?? null });
          } else {
            pending.reject(new Error(response.error));
          }
        }
      });
      byteTransformWorker.current.addEventListener('error', (event) => {
        event.preventDefault();
        const message = event instanceof ErrorEvent && event.message ? event.message : t('status.hexWorkerError');
        rejectPendingByteTransforms(message);
        onErrorRef.current(message);
      });
      byteTransformWorker.current.addEventListener('messageerror', () => {
        const message = t('status.hexWorkerUnreadable');
        rejectPendingByteTransforms(message);
        onErrorRef.current(message);
      });
    }
    return byteTransformWorker.current;
  }, [rejectPendingByteTransforms, t]);

  const runByteTransformRequestInWorker = useCallback(
    (payload: ByteTransformWorkerPayload) => {
      terminateByteTransformWorker();
      const requestId = byteTransformRequestId.current + 1;
      byteTransformRequestId.current = requestId;
      const request = { id: requestId, ...payload } satisfies ByteTransformWorkerRequest;
      const transfer: Transferable[] | null = payload.kind === 'bytes' ? [payload.bytes.buffer as ArrayBuffer] : null;
      return new Promise<ByteTransformWorkerOutput>((resolve, reject) => {
        byteTransformPromises.current.set(requestId, { resolve, reject });
        const worker = getByteTransformWorker();
        if (transfer) {
          worker.postMessage(request, transfer);
        } else {
          worker.postMessage(request);
        }
      });
    },
    [getByteTransformWorker, terminateByteTransformWorker],
  );

  const runByteTransformInWorker = useCallback(
    async (payload: ByteTransformWorkerPayload) => {
      const output = await runByteTransformRequestInWorker({ ...payload, result: 'bytes' });
      if (!output.bytes) {
        throw new Error(t('status.hexWorkerUnreadable'));
      }
      return output.bytes;
    },
    [runByteTransformRequestInWorker, t],
  );

  const runByteTransformSizeInWorker = useCallback(
    async (payload: ByteTransformWorkerPayload) => {
      const output = await runByteTransformRequestInWorker({ ...payload, result: 'size' });
      return output.byteLength;
    },
    [runByteTransformRequestInWorker],
  );

  useEffect(() => terminateByteTransformWorker, [terminateByteTransformWorker]);

  return {
    runByteTransformInWorker,
    runByteTransformSizeInWorker,
    terminateByteTransformWorker,
  };
}

export function useRtonDecodeWorker({
  t,
  onError,
}: {
  t: Translator;
  onError: (message: string) => void;
}) {
  const decodeWorker = useRef<Worker | null>(null);
  const decodeRequestId = useRef(0);
  const decodePromises = useRef(new Map<number, PendingRtonDecode>());
  const onErrorRef = useRef(onError);

  useEffect(() => {
    onErrorRef.current = onError;
  }, [onError]);

  const rejectPendingDecodes = useCallback((message: string) => {
    for (const pending of decodePromises.current.values()) {
      pending.reject(new Error(message));
    }
    decodePromises.current.clear();
  }, []);

  const terminateRtonDecodeWorker = useCallback(() => {
    decodeRequestId.current += 1;
    rejectPendingDecodes(t('status.rtonDecodeCancelled'));
    if (decodeWorker.current) {
      decodeWorker.current.terminate();
      decodeWorker.current = null;
    }
  }, [rejectPendingDecodes, t]);

  const getRtonDecodeWorker = useCallback(() => {
    if (!decodeWorker.current) {
      decodeWorker.current = new Worker(new URL('../workers/rton-decode-worker.ts', import.meta.url), { type: 'module' });
      decodeWorker.current.addEventListener('message', (event: MessageEvent<RtonDecodeWorkerResponse>) => {
        const response = event.data;
        const pending = decodePromises.current.get(response.id);
        if (!pending) {
          return;
        }

        decodePromises.current.delete(response.id);
        if (response.ok) {
          if (response.action === 'decode') {
            pending.resolve({
              value: response.value ?? null,
              document: response.document ?? null,
              stats: response.stats,
              plainBytes: response.plainBytes,
              compact: response.compact,
              encrypted: response.encrypted,
            });
          } else if (response.action === 'children') {
            pending.resolve({ nodes: response.nodes, total: response.total });
          } else if (response.action === 'search') {
            pending.resolve({
              query: response.query,
              matches: response.matches,
              scanned: response.scanned,
              done: response.done,
              capped: response.capped,
            });
          } else if (response.action === 'locate') {
            pending.resolve(response.offset);
          } else if (response.action === 'exportText') {
            pending.resolve(response.bytes);
          } else if (response.action === 'replaceDocumentBytes') {
            pending.resolve({
              document: response.document,
              stats: response.stats,
              plainBytes: response.plainBytes,
              compact: response.compact,
              encrypted: response.encrypted,
            });
          } else {
            pending.resolve(null);
          }
        } else {
          pending.reject(new Error(response.error));
        }
      });
      decodeWorker.current.addEventListener('error', (event) => {
        event.preventDefault();
        const message = event instanceof ErrorEvent && event.message ? event.message : t('status.rtonDecodeWorkerError');
        rejectPendingDecodes(message);
        onErrorRef.current(message);
      });
      decodeWorker.current.addEventListener('messageerror', () => {
        const message = t('status.rtonDecodeWorkerUnreadable');
        rejectPendingDecodes(message);
        onErrorRef.current(message);
      });
    }

    return decodeWorker.current;
  }, [rejectPendingDecodes, t]);

  const runRtonWorkerRequest = useCallback(
    <T,>(request: RtonDecodeWorkerRequest, transfer?: Transferable[]) => {
      return new Promise<T>((resolve, reject) => {
        decodePromises.current.set(request.id, {
          resolve: (output) => resolve(output as T),
          reject,
        });
        const worker = getRtonDecodeWorker();
        if (transfer) {
          worker.postMessage(request, transfer);
        } else {
          worker.postMessage(request);
        }
      });
    },
    [getRtonDecodeWorker],
  );

  const nextRtonDecodeRequestId = useCallback(() => {
    const requestId = decodeRequestId.current + 1;
    decodeRequestId.current = requestId;
    return requestId;
  }, []);

  const runRtonDecodeInWorker = useCallback(
    (bytes: Uint8Array, options: { includeValue?: boolean; retainDocument?: boolean } = {}) => {
      const requestId = nextRtonDecodeRequestId();
      const request = {
        action: 'decode',
        id: requestId,
        bytes,
        includeValue: options.includeValue ?? true,
        retainDocument: options.retainDocument ?? false,
      } satisfies RtonDecodeWorkerRequest;
      return runRtonWorkerRequest<RtonDecodeWorkerOutput>(request, [bytes.buffer as ArrayBuffer]);
    },
    [nextRtonDecodeRequestId, runRtonWorkerRequest],
  );

  const getRtonDocumentChildren = useCallback(
    (documentId: number, path: RtonValuePath, offset: number, limit: number) => {
      const request = {
        action: 'children',
        id: nextRtonDecodeRequestId(),
        documentId,
        path,
        offset,
        limit,
      } satisfies RtonDecodeWorkerRequest;
      return runRtonWorkerRequest<RtonDocumentChildrenOutput>(request);
    },
    [nextRtonDecodeRequestId, runRtonWorkerRequest],
  );

  const searchRtonDocument = useCallback(
    (documentId: number, query: string, limit: number) => {
      const request = {
        action: 'search',
        id: nextRtonDecodeRequestId(),
        documentId,
        query,
        limit,
      } satisfies RtonDecodeWorkerRequest;
      return runRtonWorkerRequest<RtonDocumentSearchOutput>(request);
    },
    [nextRtonDecodeRequestId, runRtonWorkerRequest],
  );

  const locateRtonDocumentOffset = useCallback(
    (documentId: number, path: RtonValuePath) => {
      const request = {
        action: 'locate',
        id: nextRtonDecodeRequestId(),
        documentId,
        path,
      } satisfies RtonDecodeWorkerRequest;
      return runRtonWorkerRequest<number | null>(request);
    },
    [nextRtonDecodeRequestId, runRtonWorkerRequest],
  );

  const exportRtonDocumentText = useCallback(
    (documentId: number, mode: RtonDocumentTextMode) => {
      const request = {
        action: 'exportText',
        id: nextRtonDecodeRequestId(),
        documentId,
        mode,
      } satisfies RtonDecodeWorkerRequest;
      return runRtonWorkerRequest<Uint8Array>(request);
    },
    [nextRtonDecodeRequestId, runRtonWorkerRequest],
  );

  const replaceRtonDocumentBytes = useCallback(
    (documentId: number, bytes: Uint8Array) => {
      const request = {
        action: 'replaceDocumentBytes',
        id: nextRtonDecodeRequestId(),
        documentId,
        bytes,
      } satisfies RtonDecodeWorkerRequest;
      return runRtonWorkerRequest<RtonDocumentByteUpdateOutput>(request, [bytes.buffer as ArrayBuffer]);
    },
    [nextRtonDecodeRequestId, runRtonWorkerRequest],
  );

  const releaseRtonDocument = useCallback(
    (documentId: number) => {
      const request = {
        action: 'release',
        id: nextRtonDecodeRequestId(),
        documentId,
      } satisfies RtonDecodeWorkerRequest;
      return runRtonWorkerRequest<null>(request);
    },
    [nextRtonDecodeRequestId, runRtonWorkerRequest],
  );

  useEffect(() => terminateRtonDecodeWorker, [terminateRtonDecodeWorker]);

  return {
    exportRtonDocumentText,
    getRtonDocumentChildren,
    locateRtonDocumentOffset,
    releaseRtonDocument,
    replaceRtonDocumentBytes,
    runRtonDecodeInWorker,
    searchRtonDocument,
    terminateRtonDecodeWorker,
  };
}
