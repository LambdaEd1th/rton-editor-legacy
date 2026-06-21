import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
  type MutableRefObject,
} from 'react';
import {
  Activity,
  CheckCheck,
  CheckCircle2,
  Download,
  FileArchive,
  FileJson,
  FileText,
  FileUp,
  FolderOpen,
  ListTree,
  Redo2,
  Search,
  Square,
  Undo2,
} from 'lucide-react';
import init, {
  decode_rton_to_value,
  decrypt_rton_data,
  encode_value_to_rton,
  encrypt_rton_data,
  json_text_to_value,
  value_to_json_text,
} from './wasm/rton-editor/rton_editor_wasm';
import { CodeEditor, type EditorJumpTarget } from './components/CodeEditor';
import { DraggableToolbar, type ToolbarGroupConfig, type ToolbarGroupId } from './components/DraggableToolbar';
import { EditorTabStrip, reorderTabs, type TabDropPlacement } from './components/EditorTabStrip';
import { HexEditor, type HexEditorJumpTarget } from './components/HexEditor';
import { LoadedFilesTree, type LoadedFileTreeItem } from './components/LoadedFilesTree';
import { MetaItem, PanelHeader, PanelResizeHandle, Stat, type PanelSide } from './components/Panels';
import type { StructuredFormatMode } from './format-conversion';
import { useI18n } from './localization/use-i18n';
import { t as translate, type Translator } from './localization/i18n';
import {
  decodeRtonValueWire,
  encodeRtonValueWire,
  rtonValueToPlain,
  type RtonValue,
} from './rton-value';
import { sampleJson } from './sample';
import { locateRtonValueOffset } from './rton-offset-map';
import { runActiveEditorShortcut, type EditorShortcutKind } from './components/keyboard-shortcuts';
import { RtonInlineSelect, type RtonInlineSelectOption } from './components/RtonInlineSelect';
import { RtonValueInspector } from './components/RtonValueInspector';
import {
  isRtonNumberKind,
  previewRtonValue,
  replaceRtonValueAtPath,
  type RtonValuePath,
  type SearchMatch,
  type SearchState,
} from './rton-value-editing';
import { locateRtonPathInText } from './rton-text-locator';

type JsonScalar = string | number | boolean | null;
type JsonValue = JsonScalar | JsonValue[] | { [key: string]: JsonValue };
type ViewMode = 'json' | 'yaml' | 'toml';
type EditorSurface = 'text' | 'hex';
type LoadableFileKind = 'rton' | ViewMode;
type BatchExportMode = 'rton' | 'json' | 'yaml' | 'toml';
type ThemePreference = 'system' | 'light' | 'dark';
type StructuredFormatter = (value: RtonValue, mode: StructuredFormatMode) => string;
type Tone = 'ok' | 'warn' | 'error';
type StatusState = { message: string; tone: Tone };

type Stats = {
  nodes: number;
  objects: number;
  arrays: number;
  strings: number;
  numbers: number;
  booleans: number;
  nulls: number;
  rtids: number;
  binaries: number;
  maxDepth: number;
};

type EditorTab = {
  id: number;
  fileName: string;
  sourceBytes: Uint8Array | null;
  binaryBytes: Uint8Array | null;
  binaryEncoding: RtonBinaryEncoding | null;
  currentValue: RtonValue | null;
  editorText: string;
  lastOutputBytes: number | null;
  parsedJson: JsonValue | null;
  parseError: string | null;
  stats: Stats;
  viewMode: ViewMode;
  editorSurface: EditorSurface;
  surfaceNote: string;
  searchQuery: string;
  searchState: SearchState;
  status: StatusState;
};

type RtonLoadEntry = {
  file: File;
  path: string;
};

type LoadableFileCandidate = RtonLoadEntry & {
  kind: LoadableFileKind;
};

type DroppedRtonEntries = {
  entries: RtonLoadEntry[];
  containsDirectory: boolean;
};

type LoadedRtonFile = {
  id: number;
  file: File;
  kind: LoadableFileKind;
  path: string;
  tabId: number | null;
};

type ZipFileEntry = {
  path: string;
  bytes: Uint8Array;
};

type DirectoryPickerWindow = Window & {
  showDirectoryPicker?: () => Promise<FileSystemDirectoryHandle>;
};

type FormatWorkerResponse =
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
      action: 'format' | 'parse';
      id: number;
      mode: ViewMode;
      ok: false;
      error: string;
    };

type RtonBinaryEncoding = {
  compact: boolean;
  encrypted: boolean;
};

type ByteTransformWorkerResponse =
  | {
      id: number;
      ok: true;
      bytes: Uint8Array;
    }
  | {
      id: number;
      ok: false;
      error: string;
    };

type ByteTransformWorkerRequest =
  | {
      id: number;
      kind: 'value';
      target: RtonBinaryEncoding;
      value: RtonValue;
    }
  | {
      id: number;
      kind: 'bytes';
      source: RtonBinaryEncoding;
      target: RtonBinaryEncoding;
      bytes: Uint8Array;
    };

type ByteTransformWorkerPayload =
  | {
      kind: 'value';
      target: RtonBinaryEncoding;
      value: RtonValue;
    }
  | {
      kind: 'bytes';
      source: RtonBinaryEncoding;
      target: RtonBinaryEncoding;
      bytes: Uint8Array;
    };

type SearchFrame =
  | { kind: 'value'; value: RtonValue; path: string; valuePath: RtonValuePath }
  | { kind: 'array'; value: RtonValue[]; path: string; valuePath: RtonValuePath; index: number }
  | { kind: 'object'; value: Array<{ key: string; value: RtonValue }>; path: string; valuePath: RtonValuePath; index: number };

const SEARCH_MATCH_LIMIT = 120;
const SEARCH_CHUNK_MS = 10;
const SEARCH_DEBOUNCE_MS = 140;
const EDITOR_PARSE_DEBOUNCE_MS = 450;
const FORMAT_WORKER_TIMEOUT_MS = 20_000;
const LEFT_PANEL_DEFAULT_WIDTH = 300;
const RIGHT_PANEL_DEFAULT_WIDTH = 380;
const PANEL_MIN_WIDTH = 220;
const PANEL_MAX_WIDTH = 560;
const THEME_PREFERENCE_KEY = 'rton-editor-theme-preference';
const LINE_WRAPPING_PREFERENCE_KEY = 'rton-editor-line-wrapping';
const SYSTEM_DARK_QUERY = '(prefers-color-scheme: dark)';
const LOADABLE_FILE_ACCEPT =
  '.rton,.dat,.json,.yaml,.yml,.toml,application/octet-stream,application/json,application/yaml,text/yaml,application/toml,text/toml,text/plain';
const LOADABLE_FILE_HINT = '.rton / .dat / .json / .yaml / .yml / .toml';

const buttonBase =
  'inline-flex h-7 min-w-0 shrink-0 items-center justify-center gap-1 whitespace-nowrap rounded border px-2.5 text-[13px] leading-none transition-colors focus-visible:outline-none disabled:cursor-not-allowed disabled:opacity-45';

if (typeof window !== 'undefined' && typeof document !== 'undefined') {
  applyThemePreference(readThemePreference());
}

export function App() {
  const { lang, langs, getLangLabel, setLang, t } = useI18n();
  const [tabs, setTabs] = useState<EditorTab[]>([]);
  const [loadedFiles, setLoadedFiles] = useState<LoadedRtonFile[]>([]);
  const [selectedFileKeys, setSelectedFileKeys] = useState<Set<string>>(() => new Set());
  const [activeTabId, setActiveTabId] = useState<number | null>(null);
  const [wasmReady, setWasmReady] = useState(false);
  const [fileName, setFileName] = useState('');
  const [sourceBytes, setSourceBytes] = useState<Uint8Array | null>(null);
  const [binaryBytes, setBinaryBytes] = useState<Uint8Array | null>(null);
  const [binaryEncoding, setBinaryEncoding] = useState<RtonBinaryEncoding | null>(null);
  const [currentValue, setCurrentValue] = useState<RtonValue | null>(null);
  const [editorText, setEditorTextState] = useState('');
  const [editorJumpTarget, setEditorJumpTarget] = useState<EditorJumpTarget | null>(null);
  const [hexJumpTarget, setHexJumpTarget] = useState<HexEditorJumpTarget | null>(null);
  const [lastOutputBytes, setLastOutputBytes] = useState<number | null>(null);
  const [compactOutput, setCompactOutput] = useState(false);
  const [encryptOutput, setEncryptOutput] = useState(false);
  const [parsedJson, setParsedJson] = useState<JsonValue | null>(null);
  const [parseError, setParseError] = useState<string | null>(null);
  const [stats, setStats] = useState(() => emptyStats());
  const [viewMode, setViewModeState] = useState<ViewMode>('json');
  const [editorSurface, setEditorSurface] = useState<EditorSurface>('text');
  const [surfaceNote, setSurfaceNote] = useState(() => t('app.waitingFile'));
  const [status, setStatus] = useState<StatusState>(() => ({ message: t('status.wasmInitializing'), tone: 'warn' }));
  const [fileSearchQuery, setFileSearchQuery] = useState('');
  const [searchQuery, setSearchQuery] = useState('');
  const [searchState, setSearchState] = useState<SearchState>(() => ({ kind: 'message', message: t('app.emptyFile') }));
  const [dragging, setDragging] = useState(false);
  const [leftPanelWidth, setLeftPanelWidth] = useState(LEFT_PANEL_DEFAULT_WIDTH);
  const [rightPanelWidth, setRightPanelWidth] = useState(RIGHT_PANEL_DEFAULT_WIDTH);
  const [themePreference, setThemePreference] = useState<ThemePreference>(() => readThemePreference());
  const [lineWrapping, setLineWrapping] = useState(() => readLineWrappingPreference());
  const [editorSearchPanelVisible, setEditorSearchPanelVisible] = useState(false);

  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const nextTabId = useRef(1);
  const nextLoadedFileId = useRef(1);
  const nextEditorJumpId = useRef(1);
  const nextHexJumpId = useRef(1);
  const currentValueRef = useRef<RtonValue | null>(currentValue);
  const viewModeRef = useRef<ViewMode>(viewMode);
  const parseTimer = useRef<number | null>(null);
  const searchTimer = useRef<number | null>(null);
  const formatTimeout = useRef<number | null>(null);
  const activeSearchId = useRef(0);
  const formatWorker = useRef<Worker | null>(null);
  const activeFormatRequest = useRef<{ action: 'format' | 'parse'; id: number; mode: ViewMode } | null>(null);
  const formatRequestId = useRef(0);
  const byteTransformWorker = useRef<Worker | null>(null);
  const byteTransformRequestId = useRef(0);
  const byteTransformPromises = useRef(
    new Map<
      number,
      {
        resolve: (bytes: Uint8Array) => void;
        reject: (error: Error) => void;
      }
    >(),
  );
  const themeOptions = useMemo<Array<RtonInlineSelectOption<ThemePreference>>>(
    () => [
      { value: 'system', label: t('theme.system') },
      { value: 'light', label: t('theme.light') },
      { value: 'dark', label: t('theme.dark') },
    ],
    [lang, t],
  );
  const languageOptions = useMemo<Array<RtonInlineSelectOption<string>>>(
    () => langs.map((value) => ({ value, label: getLangLabel(value) })),
    [getLangLabel, lang, langs],
  );

  const setCurrentValueState = useCallback((value: RtonValue | null) => {
    currentValueRef.current = value;
    setCurrentValue(value);
  }, []);

  const updateStatus = useCallback((message: string, tone: Tone = 'warn') => {
    setStatus({ message, tone });
  }, []);

  const clearParseTimer = useCallback(() => {
    if (parseTimer.current !== null) {
      window.clearTimeout(parseTimer.current);
      parseTimer.current = null;
    }
  }, []);

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

  const beginFormatWorkerRequest = useCallback(
    (action: 'format' | 'parse', mode: ViewMode) => {
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

  const handleFormatWorkerFailure = useCallback(
    (message: string) => {
      const request = activeFormatRequest.current;
      terminateFormatWorker();
      if (!request) {
        updateStatus(message, 'error');
        return;
      }

      const label = request.mode.toUpperCase();
      if (request.action === 'format') {
        setEditorTextState(t('format.previewUnavailableText', { label, message }));
        setSurfaceNote(t('format.previewUnavailable', { label }));
        updateStatus(t('format.previewFailed', { label, message }), 'error');
      } else {
        const parseMessage = t('format.parseFailed', { label, message });
        setParseError(parseMessage);
        setSearchState({ kind: 'message', message: parseMessage });
        setSurfaceNote(parseMessage);
        updateStatus(parseMessage, 'error');
      }
    },
    [t, terminateFormatWorker, updateStatus],
  );

  const scheduleFormatWorkerTimeout = useCallback(
    (requestId: number, mode: ViewMode, action: 'format' | 'parse') => {
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
        handleFormatWorkerFailure(t(action === 'format' ? 'format.formatTimeout' : 'format.parseTimeout', { label }));
      }, FORMAT_WORKER_TIMEOUT_MS);
    },
    [clearFormatTimeout, handleFormatWorkerFailure, t],
  );

  const clearPendingWork = useCallback(() => {
    clearParseTimer();
    if (searchTimer.current !== null) {
      window.clearTimeout(searchTimer.current);
      searchTimer.current = null;
    }
    activeSearchId.current += 1;
    invalidateFormatWork();
  }, [clearParseTimer, invalidateFormatWork]);

  const terminateByteTransformWorker = useCallback(() => {
    byteTransformRequestId.current += 1;
    for (const pending of byteTransformPromises.current.values()) {
      pending.reject(new Error(t('status.byteTransformCancelled')));
    }
    byteTransformPromises.current.clear();
    if (byteTransformWorker.current) {
      byteTransformWorker.current.terminate();
      byteTransformWorker.current = null;
    }
  }, [t]);

  const getByteTransformWorker = useCallback(() => {
    if (!byteTransformWorker.current) {
      byteTransformWorker.current = new Worker(new URL('./byte-transform-worker.ts', import.meta.url), { type: 'module' });
      byteTransformWorker.current.addEventListener('message', (event: MessageEvent<ByteTransformWorkerResponse>) => {
        const response = event.data;
        const pending = byteTransformPromises.current.get(response.id);
        if (pending) {
          byteTransformPromises.current.delete(response.id);
          if (response.ok) {
            pending.resolve(response.bytes);
          } else {
            pending.reject(new Error(response.error));
          }
        }
      });
      byteTransformWorker.current.addEventListener('error', (event) => {
        event.preventDefault();
        const message = event instanceof ErrorEvent && event.message ? event.message : t('status.hexWorkerError');
        for (const pending of byteTransformPromises.current.values()) {
          pending.reject(new Error(message));
        }
        byteTransformPromises.current.clear();
        updateStatus(message, 'error');
      });
      byteTransformWorker.current.addEventListener('messageerror', () => {
        const message = t('status.hexWorkerUnreadable');
        for (const pending of byteTransformPromises.current.values()) {
          pending.reject(new Error(message));
        }
        byteTransformPromises.current.clear();
        updateStatus(message, 'error');
      });
    }
    return byteTransformWorker.current;
  }, [t, updateStatus]);

  const runByteTransformInWorker = useCallback(
    (payload: ByteTransformWorkerPayload) => {
      terminateByteTransformWorker();
      const requestId = byteTransformRequestId.current + 1;
      byteTransformRequestId.current = requestId;
      const request = { id: requestId, ...payload } satisfies ByteTransformWorkerRequest;
      const transfer: Transferable[] | null = payload.kind === 'bytes' ? [payload.bytes.buffer as ArrayBuffer] : null;
      return new Promise<Uint8Array>((resolve, reject) => {
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

  const snapshotActiveTab = useCallback(
    (): EditorTab | null => {
      if (activeTabId === null) {
        return null;
      }

      return {
        id: activeTabId,
        fileName,
        sourceBytes,
        binaryBytes,
        binaryEncoding,
        currentValue: currentValueRef.current,
        editorText,
        lastOutputBytes,
        parsedJson,
        parseError,
        stats,
        viewMode,
        editorSurface,
        surfaceNote,
        searchQuery,
        searchState,
        status,
      };
    },
    [
      activeTabId,
      binaryBytes,
      binaryEncoding,
      editorText,
      editorSurface,
      fileName,
      lastOutputBytes,
      parseError,
      parsedJson,
      searchQuery,
      searchState,
      sourceBytes,
      stats,
      status,
      surfaceNote,
      viewMode,
    ],
  );

  const restoreEmptyWorkspace = useCallback(
    (nextStatus: StatusState) => {
      clearPendingWork();
      viewModeRef.current = 'json';

      setActiveTabId(null);
      setFileName('');
      setSourceBytes(null);
      setBinaryBytes(null);
      setBinaryEncoding(null);
      setCurrentValueState(null);
      setEditorTextState('');
      setEditorJumpTarget(null);
      setHexJumpTarget(null);
      setLastOutputBytes(null);
      setParsedJson(null);
      setParseError(null);
      setStats(emptyStats());
      setViewModeState('json');
      setEditorSurface('text');
      setSurfaceNote(t('app.waitingFile'));
      setSearchQuery('');
      setSearchState({ kind: 'message', message: t('app.emptyFile') });
      setEditorSearchPanelVisible(false);
      setStatus(nextStatus);
    },
    [clearPendingWork, setCurrentValueState, t],
  );

  const restoreEditorTab = useCallback(
    (tab: EditorTab) => {
      clearPendingWork();
      viewModeRef.current = tab.viewMode;

      setActiveTabId(tab.id);
      setFileName(tab.fileName);
      setSourceBytes(tab.sourceBytes);
      setBinaryBytes(tab.binaryBytes);
      setBinaryEncoding(tab.binaryEncoding);
      setCurrentValueState(tab.currentValue);
      setEditorTextState(tab.editorText);
      setEditorJumpTarget(null);
      setHexJumpTarget(null);
      setLastOutputBytes(tab.lastOutputBytes);
      setParsedJson(tab.parsedJson);
      setParseError(tab.parseError);
      setStats(tab.stats);
      setViewModeState(tab.viewMode);
      setEditorSurface(tab.editorSurface);
      setSurfaceNote(tab.surfaceNote);
      setSearchQuery(tab.searchQuery);
      setSearchState(tab.searchState);
      setStatus(tab.status);
    },
    [clearPendingWork, setCurrentValueState],
  );

  const syncActiveTab = useCallback(
    (nextTabs: EditorTab[] = tabs) => {
      const snapshot = snapshotActiveTab();
      if (!snapshot) {
        return nextTabs;
      }
      return nextTabs.map((tab) => (tab.id === snapshot.id ? snapshot : tab));
    },
    [snapshotActiveTab, tabs],
  );

  const openEditorTabs = useCallback(
    (newTabs: EditorTab[]) => {
      if (newTabs.length === 0) {
        return;
      }

      const nextActive = newTabs[newTabs.length - 1];
      setTabs([...syncActiveTab(), ...newTabs]);
      restoreEditorTab(nextActive);
    },
    [restoreEditorTab, syncActiveTab],
  );

  const activateEditorTab = useCallback(
    (tabId: number) => {
      if (tabId === activeTabId) {
        return;
      }

      const syncedTabs = syncActiveTab();
      const target = syncedTabs.find((tab) => tab.id === tabId);
      if (!target) {
        return;
      }

      setTabs(syncedTabs);
      restoreEditorTab(target);
    },
    [activeTabId, restoreEditorTab, syncActiveTab],
  );

  const closeEditorTab = useCallback(
    (tabId: number) => {
      const syncedTabs = syncActiveTab();
      const closeIndex = syncedTabs.findIndex((tab) => tab.id === tabId);
      if (closeIndex === -1) {
        return;
      }

      setLoadedFiles((files) => files.map((file) => (file.tabId === tabId ? { ...file, tabId: null } : file)));

      const nextTabs = syncedTabs.filter((tab) => tab.id !== tabId);
      if (nextTabs.length === 0) {
        setTabs([]);
        restoreEmptyWorkspace({ message: t('status.noOpenFiles'), tone: 'warn' });
        return;
      }

      setTabs(nextTabs);
      if (tabId === activeTabId) {
        const nextActive = syncedTabs[closeIndex + 1] ?? syncedTabs[closeIndex - 1] ?? nextTabs[0];
        restoreEditorTab(nextActive);
      }
    },
    [activeTabId, restoreEditorTab, restoreEmptyWorkspace, syncActiveTab, t],
  );

  const moveEditorTab = useCallback(
    (tabId: number, targetTabId: number, placement: TabDropPlacement) => {
      if (tabId === targetTabId || tabs.length < 2) {
        return;
      }
      setTabs(reorderTabs(syncActiveTab(), tabId, targetTabId, placement));
    },
    [syncActiveTab, tabs.length],
  );

  const parseJsonText = useCallback(
    (jsonText: string, options: { updateEditor?: boolean; statusMessage?: string } = {}) => {
      clearParseTimer();
      activeSearchId.current += 1;

      if (!wasmReady) {
        updateStatus(t('status.wasmStillLoading'), 'warn');
        return;
      }

      try {
        const value = parseJsonTextToRtonValue(jsonText);
        const plainValue = rtonValueToJsonValue(value);
        setCurrentValueState(value);
        setParsedJson(plainValue);
        setParseError(null);
        setStats(collectStats(value));
        if (options.updateEditor || viewModeRef.current === 'json') {
          setEditorTextState(jsonText);
          setSurfaceNote(t('format.editable', { label: viewModeRef.current.toUpperCase() }));
        }
        if (options.statusMessage) {
          updateStatus(options.statusMessage, 'ok');
        }
      } catch (error) {
        const message = errorMessage(error);
        setCurrentValueState(null);
        setParsedJson(null);
        setParseError(message);
        setStats(emptyStats());
        setSearchState({ kind: 'message', message });
        updateStatus(message, 'error');
      }
    },
    [clearParseTimer, setCurrentValueState, t, updateStatus, wasmReady],
  );

	  const getFormatWorker = useCallback(() => {
	    if (!formatWorker.current) {
	      formatWorker.current = new Worker(new URL('./format-worker.ts', import.meta.url), { type: 'module' });
	      formatWorker.current.addEventListener('message', (event: MessageEvent<FormatWorkerResponse>) => {
	        const response = event.data;
	        if (response.id !== formatRequestId.current || response.mode !== viewModeRef.current) {
	          return;
	        }

	        clearFormatTimeout();
	        activeFormatRequest.current = null;
	
	        const label = response.mode.toUpperCase();
	        if (response.ok && response.action === 'format') {
	          setEditorTextState(response.text);
	          setSurfaceNote(response.truncated ? t('format.previewTruncated', { label }) : t('format.editable', { label }));
	          updateStatus(response.truncated ? t('format.generatedTruncated', { label }) : t('format.generated', { label }), response.truncated ? 'warn' : 'ok');
	        } else if (response.ok && response.action === 'parse') {
          const plainValue = response.plainValue as JsonValue;
          setCurrentValueState(response.value);
          setParsedJson(plainValue);
          setParseError(null);
          setStats(collectStats(response.value));
          setSearchState({ kind: 'idle' });
          setSurfaceNote(t('format.editable', { label }));
          updateStatus(t('format.parsed', { label }), 'ok');
        } else if (!response.ok && response.action === 'format') {
          setEditorTextState(t('format.previewUnavailableText', { label, message: response.error }));
          setSurfaceNote(t('format.previewUnavailable', { label }));
          updateStatus(t('format.previewFailed', { label, message: response.error }), 'error');
        } else if (!response.ok && response.action === 'parse') {
          const message = t('format.parseFailed', { label, message: response.error });
          setCurrentValueState(null);
          setParseError(message);
          setSearchState({ kind: 'message', message });
          setSurfaceNote(message);
	          updateStatus(message, 'error');
	        }
	      });
	      formatWorker.current.addEventListener('error', (event) => {
	        event.preventDefault();
	        handleFormatWorkerFailure(event instanceof ErrorEvent && event.message ? event.message : t('status.formatWorkerError'));
	      });
	      formatWorker.current.addEventListener('messageerror', () => {
	        handleFormatWorkerFailure(t('status.formatWorkerUnreadable'));
	      });
	    }
	
	    return formatWorker.current;
	  }, [clearFormatTimeout, handleFormatWorkerFailure, setCurrentValueState, t, updateStatus]);

	  const renderTextForValue = useCallback(
	    (value: RtonValue, mode: ViewMode) => {
	      const requestId = beginFormatWorkerRequest('format', mode);
	      const label = mode.toUpperCase();
	      setSurfaceNote(t('format.generatingPreview', { label }));
	      setEditorTextState(t('format.generatingPreviewText', { label }));
	      scheduleFormatWorkerTimeout(requestId, mode, 'format');
	      getFormatWorker().postMessage({
	        action: 'format',
	        id: requestId,
        value,
        mode,
	      });
	      return true;
	    },
	    [beginFormatWorkerRequest, getFormatWorker, scheduleFormatWorkerTimeout, t],
	  );
	
	  const renderAlternateFormat = useCallback(
	    (mode: Exclude<ViewMode, 'json'>) => {
	      const label = mode.toUpperCase();
	      setSurfaceNote(t('format.generatingPreview', { label }));
	
	      if (parseError) {
	        invalidateFormatWork();
	        setEditorTextState(t('format.unparseablePreview', { label, message: parseError }));
	        setSurfaceNote(t('format.previewUnavailable', { label }));
	        return;
      }
	
	      const value = currentValueRef.current;
	      if (!value) {
	        invalidateFormatWork();
	        setEditorTextState(t('format.noValuePreview', { label }));
	        setSurfaceNote(t('format.previewUnavailable', { label }));
	        return;
	      }
	
	      const requestId = beginFormatWorkerRequest('format', mode);
	      setEditorTextState(t('format.generatingPreviewText', { label }));
	      scheduleFormatWorkerTimeout(requestId, mode, 'format');
	      getFormatWorker().postMessage({
	        action: 'format',
	        id: requestId,
        value,
        mode,
	      });
	    },
	    [beginFormatWorkerRequest, getFormatWorker, invalidateFormatWork, parseError, scheduleFormatWorkerTimeout, t],
	  );
	
	  const parseAlternateFormat = useCallback(
	    (mode: Exclude<ViewMode, 'json'>, text: string) => {
	      clearParseTimer();
	      const requestId = beginFormatWorkerRequest('parse', mode);
	      const label = mode.toUpperCase();
	      setSurfaceNote(t('format.parsing', { label }));
	      scheduleFormatWorkerTimeout(requestId, mode, 'parse');
	      getFormatWorker().postMessage({
	        action: 'parse',
	        id: requestId,
        mode,
	        text,
	      });
	    },
	    [beginFormatWorkerRequest, clearParseTimer, getFormatWorker, scheduleFormatWorkerTimeout, t],
	  );

  const scheduleEditorParse = useCallback(
    (mode: ViewMode, text: string) => {
      clearParseTimer();
      activeSearchId.current += 1;
      setLastOutputBytes(null);
      if (mode === 'json') {
        setSearchState({ kind: 'message', message: t('format.waitJsonParse') });
        parseTimer.current = window.setTimeout(() => {
          parseJsonText(text);
        }, EDITOR_PARSE_DEBOUNCE_MS);
      } else {
        const label = mode.toUpperCase();
        setSearchState({ kind: 'message', message: t('format.waitParse', { label }) });
        setSurfaceNote(t('format.editing', { label }));
        parseTimer.current = window.setTimeout(() => {
          parseAlternateFormat(mode, text);
        }, EDITOR_PARSE_DEBOUNCE_MS);
      }
    },
    [clearParseTimer, parseAlternateFormat, parseJsonText, t],
  );

  const setViewMode = useCallback(
    (mode: ViewMode) => {
      if (activeTabId === null) {
        updateStatus(t('status.openFileFirst'), 'warn');
        return;
      }

	      if (mode === viewModeRef.current) {
	        setEditorSurface('text');
	        if (editorSurface === 'hex') {
	          const value = currentValueRef.current;
	          if (value) {
	            renderTextForValue(value, mode);
	          }
	        }
	        return;
	      }

	      viewModeRef.current = mode;
	      setViewModeState(mode);
	      setEditorSurface('text');
	      invalidateFormatWork();

      if (mode === 'json') {
        const value = currentValueRef.current;
        if (!value) {
          updateStatus(parseError ? t('format.jsonCannotConvert', { message: parseError }) : t('status.noSearchableValue'), 'error');
          setSurfaceNote(t('format.jsonPreviewUnavailable'));
          return;
        }

	        renderTextForValue(value, mode);
	      } else {
	        renderAlternateFormat(mode);
	      }
	    },
			    [activeTabId, editorSurface, invalidateFormatWork, parseError, renderAlternateFormat, renderTextForValue, t, updateStatus],
			  );

  const hasActiveFile = activeTabId !== null && tabs.length > 0;
  const displayFileName = hasActiveFile ? fileName : t('app.emptyFile');
  const targetBinaryEncoding = useMemo<RtonBinaryEncoding>(
    () => ({ compact: compactOutput, encrypted: encryptOutput }),
    [compactOutput, encryptOutput],
  );
  const hexOutputMatchesSource = binaryEncoding !== null && sameRtonEncoding(binaryEncoding, targetBinaryEncoding);
  const displayedHexBytes = binaryBytes;
  const outputText = hasActiveFile
    ? editorSurface === 'hex' && binaryBytes
      ? `${formatBytes(binaryBytes.byteLength)} · ${t('app.rawBytes')}`
      : lastOutputBytes
        ? `${formatBytes(lastOutputBytes)} · ${compactOutput ? 'compact' : 'standard'}${encryptOutput ? ' · encrypted' : ''}`
        : t('app.notGenerated')
    : t('app.noOutput');
  const displaySurfaceNote =
    editorSurface === 'hex'
      ? binaryBytes
        ? `RTON · ${formatBytes(binaryBytes.byteLength)}`
        : t('app.rtonUnavailable')
      : surfaceNote;

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
		    editorSurface,
		    hexOutputMatchesSource,
		    parseError,
	    t,
	    targetBinaryEncoding,
	    updateStatus,
	    wasmReady,
	  ]);

  const refreshOutputBytesForOptions = useCallback(() => {
    setLastOutputBytes(null);
  }, []);

  useEffect(() => {
    viewModeRef.current = viewMode;
  }, [viewMode]);

  useEffect(() => {
    applyThemePreference(themePreference);
    saveThemePreference(themePreference);

    const media = window.matchMedia(SYSTEM_DARK_QUERY);
    const handleSystemThemeChange = () => {
      if (themePreference === 'system') {
        applyThemePreference(themePreference);
      }
    };

    media.addEventListener('change', handleSystemThemeChange);
    return () => media.removeEventListener('change', handleSystemThemeChange);
  }, [themePreference]);

  useEffect(() => {
    saveLineWrappingPreference(lineWrapping);
  }, [lineWrapping]);

  useEffect(() => {
    if (editorSurface === 'hex' && !binaryBytes) {
      setEditorSurface('text');
    }
  }, [binaryBytes, editorSurface]);

  useEffect(() => {
    currentValueRef.current = currentValue;
  }, [currentValue]);

  useEffect(() => {
    if (activeTabId === null) {
      setCompactOutput(false);
      setEncryptOutput(false);
      return;
    }
	    if (binaryEncoding) {
	      setCompactOutput(binaryEncoding.compact);
	      setEncryptOutput(binaryEncoding.encrypted);
	      return;
	    }
	    setCompactOutput(false);
	    setEncryptOutput(false);
	  }, [activeTabId, binaryEncoding]);

  useEffect(() => {
    void init()
      .then(() => {
        setWasmReady(true);
        updateStatus(t('status.wasmReady'), 'ok');
      })
      .catch((error: unknown) => {
        updateStatus(errorMessage(error), 'error');
      });

    return () => {
      if (parseTimer.current !== null) {
        window.clearTimeout(parseTimer.current);
      }
      if (searchTimer.current !== null) {
        window.clearTimeout(searchTimer.current);
      }
      formatWorker.current?.terminate();
    };
  }, [t, updateStatus]);

  useEffect(() => {
    if (wasmReady && activeTabId !== null) {
      validateValue();
    }
  }, [activeTabId, validateValue, wasmReady]);

  useEffect(() => {
    if (searchTimer.current !== null) {
      window.clearTimeout(searchTimer.current);
    }
    activeSearchId.current += 1;

    if (activeTabId === null) {
      setSearchState({ kind: 'message', message: t('app.emptyFile') });
      return;
    }

    const query = searchQuery.trim().toLowerCase();
    if (parseError) {
      setSearchState({ kind: 'message', message: parseError });
      return;
    }

    if (!currentValue) {
      setSearchState({ kind: 'message', message: t('status.noSearchableValue') });
      return;
    }

    if (!query) {
      setSearchState({ kind: 'idle' });
      return;
    }

    setSearchState({ kind: 'message', message: t('status.searching', { query }) });
    const searchId = activeSearchId.current + 1;
    activeSearchId.current = searchId;
    searchTimer.current = window.setTimeout(() => {
      runChunkedSearch(currentValue, query, searchId, activeSearchId, setSearchState);
    }, SEARCH_DEBOUNCE_MS);
  }, [activeTabId, currentValue, parseError, searchQuery, t]);

	  const loadedFileItems = useMemo(
    () => buildLoadedFileItems({ files: loadedFiles, tabs, activeTabId, fileName, sourceBytes, viewMode, editorSurface, t }),
    [activeTabId, editorSurface, fileName, lang, loadedFiles, sourceBytes, tabs, viewMode, t],
  );
  const filteredLoadedFileItems = useMemo(
    () => filterLoadedFileItems(loadedFileItems, fileSearchQuery),
    [fileSearchQuery, loadedFileItems],
  );
  const fileSearchActive = fileSearchQuery.trim().length > 0;
  const listedFileCount = loadedFileItems.length;
  const visibleFileCount = filteredLoadedFileItems.length;
  const selectedFileCount = selectedFileKeys.size;
  const selectedVisibleFileCount = filteredLoadedFileItems.reduce(
    (count, item) => count + (selectedFileKeys.has(item.key) ? 1 : 0),
    0,
  );
  const fileListSubtitle = fileSearchActive
    ? t('fileList.matchCount', {
        visible: visibleFileCount.toLocaleString(),
        total: listedFileCount.toLocaleString(),
        selected: selectedFileCount.toLocaleString(),
      })
    : t('fileList.selectedCount', {
        selected: selectedFileCount.toLocaleString(),
        total: listedFileCount.toLocaleString(),
      });
  const workspaceStyle = {
    '--rton-left-panel-width': `${leftPanelWidth}px`,
    '--rton-right-panel-width': `${rightPanelWidth}px`,
  } as CSSProperties;

  useEffect(() => terminateByteTransformWorker, [terminateByteTransformWorker]);

  const resizePanel = useCallback((side: PanelSide, width: number) => {
    const clamped = clampPanelWidth(width);
    if (side === 'left') {
      setLeftPanelWidth(clamped);
    } else {
      setRightPanelWidth(clamped);
    }
  }, []);

  useEffect(() => {
    const availableKeys = new Set(loadedFileItems.map((item) => item.key));
    setSelectedFileKeys((current) => {
      const next = new Set([...current].filter((key) => availableKeys.has(key)));
      return next.size === current.size ? current : next;
    });
  }, [loadedFileItems]);

  const selectAllListedFiles = useCallback(() => {
    setSelectedFileKeys((current) => {
      const next = new Set(current);
      filteredLoadedFileItems.forEach((item) => next.add(item.key));
      return next;
    });
  }, [filteredLoadedFileItems]);

  const clearSelectedFiles = useCallback(() => {
    setSelectedFileKeys((current) => {
      const next = new Set(current);
      filteredLoadedFileItems.forEach((item) => next.delete(item.key));
      return next;
    });
  }, [filteredLoadedFileItems]);

  const toggleSelectedFile = useCallback((key: string, selected: boolean) => {
    setSelectedFileKeys((current) => {
      const next = new Set(current);
      if (selected) {
        next.add(key);
      } else {
        next.delete(key);
      }
      return next;
    });
  }, []);

  const toggleSelectedFiles = useCallback((keys: string[], selected: boolean) => {
    setSelectedFileKeys((current) => {
      const next = new Set(current);
      keys.forEach((key) => {
        if (selected) {
          next.add(key);
        } else {
          next.delete(key);
        }
      });
      return next;
    });
  }, []);

	  const onEditorInput = (value: string) => {
	    if (activeTabId === null) {
	      return;
	    }
	
	    setBinaryBytes(null);
	    setBinaryEncoding(null);
	    setEditorTextState(value);
	    scheduleEditorParse(viewModeRef.current, value);
	  };

  const openHexEditor = useCallback(() => {
    if (activeTabId === null) {
      updateStatus(t('status.openFileFirst'), 'warn');
      return;
    }

    if (binaryBytes) {
      setEditorSurface('hex');
      setSurfaceNote(t('format.rtonEditable'));
      return;
    }

    const value = currentValueRef.current;
    if (!value) {
      updateStatus(parseError ?? t('status.noSearchableValue'), 'error');
      return;
    }

    try {
	      const bytes = encodeRtonOutputBytes(value, compactOutput, encryptOutput);
	      setBinaryBytes(bytes);
	      setBinaryEncoding({ compact: compactOutput, encrypted: encryptOutput });
      setSourceBytes(bytes);
      setLastOutputBytes(null);
      setEditorSurface('hex');
      setSurfaceNote(t('format.rtonEditable'));
      updateStatus(t('status.rtonBinaryGenerated'), 'ok');
    } catch (error) {
      updateStatus(errorMessage(error), 'error');
    }
  }, [activeTabId, binaryBytes, compactOutput, encryptOutput, parseError, t, updateStatus]);

  const onHexBytesChange = useCallback(
    (nextBytes: Uint8Array) => {
      if (activeTabId === null) {
        return;
      }

      clearPendingWork();
      setBinaryBytes(nextBytes);
      setSourceBytes(nextBytes);
      setLastOutputBytes(null);

      try {
	      const { value, encrypted, compact } = decodeRtonSourceValue(nextBytes);
	      setCurrentValueState(value);
	      setParsedJson(rtonValueToJsonValue(value));
	      setParseError(null);
	      setStats(collectStats(value));
	      setBinaryEncoding({ compact, encrypted });
	      setSearchState({ kind: 'idle' });
        renderTextForValue(value, viewModeRef.current);
        setSurfaceNote(t('format.rtonEditable'));
        updateStatus(t('status.rtonUpdated', { prefix: encrypted ? `${t('toolbar.encrypted')} ` : '' }), 'ok');
      } catch (error) {
        const message = errorMessage(error);
        invalidateFormatWork();
        setCurrentValueState(null);
        setParsedJson(null);
        setParseError(message);
        setStats(emptyStats());
        setSearchState({ kind: 'message', message });
        setSurfaceNote(t('format.rtonParseUnavailable'));
        updateStatus(t('status.rtonUpdateFailed', { message }), 'error');
      }
    },
	    [activeTabId, clearPendingWork, invalidateFormatWork, renderTextForValue, setCurrentValueState, t, updateStatus],
	  );

  const loadSample = () => {
    if (!wasmReady) {
      updateStatus(t('status.wasmStillLoading'), 'warn');
      return;
    }

    try {
      const value = parseJsonTextToRtonValue(sampleJson);
      const tab = createEditorTabFromValue({
        id: nextTabId.current,
        fileName: 'sample.json',
        value,
        editorText: rtonValueToJsonText(value, true),
        sourceBytes: null,
        status: { message: t('status.sampleLoaded'), tone: 'ok' },
      });
      nextTabId.current += 1;
      openEditorTabs([tab]);
    } catch (error) {
      updateStatus(errorMessage(error), 'error');
    }
  };

  const loadRtonEntries = async (entries: RtonLoadEntry[]) => {
    if (!wasmReady) {
      updateStatus(t('status.wasmStillLoading'), 'warn');
      return;
    }

    const candidates = collectLoadableCandidates(entries, true);
    const skipped = entries.length - candidates.length;
    if (candidates.length === 0) {
      updateStatus(t('status.noLoadableFiles', { hint: LOADABLE_FILE_HINT }), 'warn');
      return;
    }

    const loadedTabs: EditorTab[] = [];
    const errors: string[] = [];
    const preferredEditorSurface: EditorSurface = activeTabId === null ? 'hex' : editorSurface;
    for (const entry of candidates) {
      try {
        const decoded = await decodeLoadableSource(entry, viewModeRef.current, preferredEditorSurface, t);
        loadedTabs.push(
          createEditorTabFromValue({
            id: nextTabId.current,
            fileName: normalizeDisplayPath(entry.path),
            value: decoded.value,
            editorText: decoded.editorText,
	            surfaceNote: decoded.surfaceNote,
	            sourceBytes: decoded.sourceBytes,
	            binaryBytes: decoded.binaryBytes,
	            binaryEncoding: decoded.binaryEncoding,
	            viewMode: decoded.viewMode,
            editorSurface: decoded.editorSurface,
            status: decoded.status,
          }),
        );
        nextTabId.current += 1;
      } catch (error) {
        errors.push(`${normalizeDisplayPath(entry.path)}: ${errorMessage(error)}`);
      }
    }

	    if (loadedTabs.length > 0) {
	      openEditorTabs(loadedTabs);
	      const nextActive = loadedTabs[loadedTabs.length - 1];
	      if (nextActive.editorSurface === 'text' && nextActive.currentValue && isPendingTextPreview(nextActive.editorText)) {
	        window.setTimeout(() => renderTextForValue(nextActive.currentValue as RtonValue, nextActive.viewMode), 0);
	      }
	      const suffix = skipped > 0 ? t('status.skippedFiles', { count: skipped.toLocaleString() }) : '';
	      const message = loadedTabs.length === 1
          ? `${loadedTabs[0].status.message}${suffix}`
          : t('status.loadedFiles', { count: loadedTabs.length.toLocaleString(), suffix });
	      updateStatus(message, 'ok');
    }

    if (errors.length > 0) {
      updateStatus(errors.join('；'), 'error');
    }
  };

  const stageRtonEntries = useCallback(
    (entries: RtonLoadEntry[]) => {
      const candidates = collectLoadableCandidates(entries, false);
      const skipped = entries.length - candidates.length;
      if (candidates.length === 0) {
        updateStatus(t('status.noLoadableFiles', { hint: LOADABLE_FILE_HINT }), 'warn');
        return;
      }

      const nextFiles = candidates.map(({ file, kind, path }) => {
        const item: LoadedRtonFile = {
          id: nextLoadedFileId.current,
          file,
          kind,
          path: normalizeDisplayPath(path),
          tabId: null,
        };
        nextLoadedFileId.current += 1;
        return item;
      });

      setLoadedFiles(nextFiles);
      const suffix = skipped > 0 ? t('status.skippedFiles', { count: skipped.toLocaleString() }) : '';
      updateStatus(t('status.indexedFiles', { count: nextFiles.length.toLocaleString(), suffix }), 'ok');
    },
    [t, updateStatus],
  );

  const openLoadedFile = useCallback(
    async (fileId: number) => {
      const entry = loadedFiles.find((file) => file.id === fileId);
      if (!entry) {
        return;
      }

      if (entry.tabId !== null && tabs.some((tab) => tab.id === entry.tabId)) {
        activateEditorTab(entry.tabId);
        return;
      }

      if (!wasmReady) {
        updateStatus(t('status.wasmStillLoading'), 'warn');
        return;
      }

      try {
        updateStatus(t('status.parsingPath', { path: entry.path }), 'warn');
        const preferredEditorSurface: EditorSurface = activeTabId === null ? 'hex' : editorSurface;
        const decoded = await decodeLoadableSource(entry, viewModeRef.current, preferredEditorSurface, t);
        const tabId = nextTabId.current;
        const tab = createEditorTabFromValue({
          id: tabId,
          fileName: entry.path,
          value: decoded.value,
          editorText: decoded.editorText,
	          surfaceNote: decoded.surfaceNote,
	          sourceBytes: decoded.sourceBytes,
	          binaryBytes: decoded.binaryBytes,
	          binaryEncoding: decoded.binaryEncoding,
	          viewMode: decoded.viewMode,
          editorSurface: decoded.editorSurface,
          status: decoded.status,
        });
        nextTabId.current += 1;
	        setLoadedFiles((files) => files.map((file) => (file.id === fileId ? { ...file, tabId } : file)));
	        openEditorTabs([tab]);
	        if (tab.editorSurface === 'text' && tab.currentValue && isPendingTextPreview(tab.editorText)) {
	          window.setTimeout(() => renderTextForValue(tab.currentValue as RtonValue, tab.viewMode), 0);
	        }
	        updateStatus(decoded.status.message, decoded.status.tone);
	      } catch (error) {
        updateStatus(`${entry.path}: ${errorMessage(error)}`, 'error');
      }
    },
	    [activateEditorTab, activeTabId, editorSurface, loadedFiles, openEditorTabs, renderTextForValue, t, tabs, updateStatus, wasmReady],
	  );

  const loadRtonFiles = async (files: File[]) => {
    await loadRtonEntries(files.map((file) => ({ file, path: displayFilePath(file) })));
  };

  const loadRtonFolder = async () => {
    const picker = (window as DirectoryPickerWindow).showDirectoryPicker;
    if (!picker) {
      updateStatus(t('status.folderPickerSafari'), 'warn');
      return;
    }

    try {
      const directoryHandle = await picker.call(window);
      const entries = await collectDirectoryEntries(directoryHandle, normalizeDisplayPath(directoryHandle.name));
      stageRtonEntries(entries);
    } catch (error) {
      if (error instanceof DOMException && error.name === 'AbortError') {
        return;
      }
      if (isDirectoryPickerGestureError(error)) {
        updateStatus(t('status.folderPickerDenied'), 'warn');
        return;
      }
      updateStatus(errorMessage(error), 'error');
    }
  };

  const downloadRton = async () => {
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
	  };

  const downloadJson = () => {
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
  };

  const downloadStructuredFormat = async (mode: StructuredFormatMode) => {
    if (activeTabId === null) {
      updateStatus(t('status.openFileFirst'), 'warn');
      return;
    }

    try {
      const value = currentValueRef.current;
      if (!value) {
        throw new Error(parseError ?? t('status.noSearchableValue'));
      }
      const { formatStructuredText } = await import('./format-conversion');
      const text = formatStructuredText(value, mode);
      downloadBlob(text, outputBaseName(fileName, mode), mode === 'yaml' ? 'application/yaml' : 'application/toml');
      updateStatus(t('format.generated', { label: mode.toUpperCase() }), 'ok');
    } catch (error) {
      updateStatus(errorMessage(error), 'error');
    }
  };

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
      const usedPaths = new Set<string>();
      const zipEntries: ZipFileEntry[] = [];
      const errors: string[] = [];
      const structuredFormatter =
        mode === 'yaml' || mode === 'toml' ? (await import('./format-conversion')).formatStructuredText : null;

      for (let index = 0; index < selectedItems.length; index += 1) {
        const item = selectedItems[index];
        try {
          const value = await resolveBatchItemValue(item, {
            activeTabId,
            currentValue: currentValueRef.current,
            filesById,
            tabsById,
          });
          const bytes = convertRtonValueForBatch(value, mode, {
            compact: compactOutput,
            encrypted: encryptOutput,
            structuredFormatter,
          });
          zipEntries.push({
            path: uniqueZipPath(batchOutputPath(item.path, mode, compactOutput, encryptOutput), usedPaths),
            bytes,
          });
        } catch (error) {
          errors.push(`${item.path}: ${errorMessage(error)}`);
        }

        if (index % 24 === 23) {
          await yieldToBrowser();
        }
      }

      if (zipEntries.length === 0) {
        updateStatus(errors[0] ?? t('status.noBatchSuccess'), 'error');
        return;
      }

      const zipBytes = createZipArchive(zipEntries);
      downloadBytes(zipBytes, `rton-editor-${mode}-${timestampForFileName()}.zip`);
      const errorSuffix = errors.length > 0 ? t('status.batchFailureSuffix', { count: errors.length.toLocaleString() }) : '';
      updateStatus(
        t('status.batchExported', { count: zipEntries.length.toLocaleString(), format: mode.toUpperCase(), suffix: errorSuffix }),
        errors.length > 0 ? 'warn' : 'ok',
      );
    },
    [
      activeTabId,
      compactOutput,
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

  const updateRtonValueNode = useCallback(
    (path: RtonValuePath, nextValue: RtonValue) => {
      if (activeTabId === null) {
        updateStatus(t('status.openFileFirst'), 'warn');
        return;
      }

      const current = currentValueRef.current;
      if (!current) {
        updateStatus(parseError ?? t('status.noSearchableValue'), 'error');
        return;
      }

      try {
        const updated = replaceRtonValueAtPath(current, path, nextValue);
        setCurrentValueState(updated);
        setParsedJson(rtonValueToJsonValue(updated));
        setParseError(null);
	        setStats(collectStats(updated));
	        setLastOutputBytes(null);
	        setBinaryBytes(null);
        setBinaryEncoding(null);
	        setEditorSurface('text');
        const rendered = renderTextForValue(updated, viewModeRef.current);
        updateStatus(rendered ? t('status.rtonValueUpdated') : t('status.rtonValueUpdatedNoJson'), rendered ? 'ok' : 'warn');
      } catch (error) {
        updateStatus(errorMessage(error), 'error');
      }
    },
    [activeTabId, parseError, renderTextForValue, setCurrentValueState, t, updateStatus],
  );

  const navigateToRtonValueNode = useCallback(
    (path: RtonValuePath) => {
      const value = currentValueRef.current;
      if (!value) {
        updateStatus(parseError ?? t('status.noSearchableValue'), 'warn');
        return;
      }

	      if (editorSurface === 'hex') {
	        const navigableBytes = displayedHexBytes ?? binaryBytes;
	        if (!navigableBytes) {
	          updateStatus(t('status.noJumpBytes'), 'warn');
          return;
        }
        if (isEncryptedRtonBytes(navigableBytes)) {
          updateStatus(t('status.encryptedOffsetUnavailable'), 'warn');
          return;
        }

        const offset = locateRtonValueOffset(navigableBytes, path);
        if (offset === null) {
          updateStatus(t('status.offsetNotFound'), 'warn');
          return;
        }

        setHexJumpTarget({
          id: nextHexJumpId.current,
          offset,
        });
        nextHexJumpId.current += 1;
        updateStatus(t('status.jumpedOffset', { offset: offset.toString(16).toUpperCase() }), 'ok');
        return;
      }

      const position = locateRtonPathInText(value, path, editorText, viewModeRef.current);
      if (!position) {
        updateStatus(t('status.textLineNotFound'), 'warn');
        return;
      }

      setEditorJumpTarget({
        id: nextEditorJumpId.current,
        line: position.line,
        column: position.column,
      });
      nextEditorJumpId.current += 1;
      updateStatus(t('status.jumpedLine', { line: position.line.toLocaleString() }), 'ok');
    },
    [binaryBytes, displayedHexBytes, editorSurface, editorText, parseError, t, updateStatus],
  );

  const runEditorToolbarAction = useCallback(
    (kind: EditorShortcutKind) => {
      if (!hasActiveFile) {
        return;
      }

      if (!runActiveEditorShortcut(kind) && kind === 'find') {
        setEditorSearchPanelVisible(true);
      }
    },
    [hasActiveFile],
  );

  const toolbarGroups = {
    file: {
      label: t('toolbar.file'),
      content: (
        <>
          <button type="button" onClick={() => fileInputRef.current?.click()} className={buttonClass('primary')}>
            <FileUp />
            {t('toolbar.openFile')}
          </button>
          <button type="button" onClick={() => void loadRtonFolder()} className={buttonClass('secondary')}>
            <FolderOpen />
            {t('toolbar.openFolder')}
          </button>
          <button type="button" onClick={loadSample} className={buttonClass('secondary')}>
            {t('toolbar.sample')}
          </button>
          <span className="min-w-24 max-w-80 flex-1 truncate px-1 font-semibold text-[var(--color-text-strong)]">{displayFileName}</span>
        </>
      ),
    },
    edit: {
      label: t('toolbar.edit'),
      ariaLabel: t('toolbar.edit'),
      content: (
        <>
          <button
            type="button"
            onClick={() => runEditorToolbarAction('undo')}
            disabled={!hasActiveFile}
            className={buttonClass('secondary')}
          >
            <Undo2 />
            {t('toolbar.undo')}
          </button>
          <button
            type="button"
            onClick={() => runEditorToolbarAction('redo')}
            disabled={!hasActiveFile}
            className={buttonClass('secondary')}
          >
            <Redo2 />
            {t('toolbar.redo')}
          </button>
        </>
      ),
    },
    format: {
      label: t('toolbar.textFormat'),
      role: 'tablist',
      ariaLabel: t('toolbar.textFormat'),
      content: (
        <>
          <button
            type="button"
            role="tab"
            disabled={!hasActiveFile || (!binaryBytes && !currentValue)}
            aria-selected={editorSurface === 'hex'}
            className={modeButtonClass(editorSurface === 'hex')}
            onClick={openHexEditor}
          >
            RTON
          </button>
          {(['json', 'yaml', 'toml'] as const).map((mode) => (
            <button
              key={mode}
              type="button"
              role="tab"
              disabled={!hasActiveFile}
              aria-selected={editorSurface === 'text' && viewMode === mode}
              className={modeButtonClass(editorSurface === 'text' && viewMode === mode)}
              onClick={() => setViewMode(mode)}
            >
              {mode.toUpperCase()}
            </button>
          ))}
          <span className="max-w-52 truncate px-1 text-xs uppercase text-[var(--color-text-muted)] max-lg:hidden">{displaySurfaceNote}</span>
        </>
      ),
    },
    textExport: {
      label: t('toolbar.textExport'),
      ariaLabel: t('toolbar.textExport'),
      content: (
        <>
          <button
            type="button"
            onClick={downloadJson}
            disabled={!hasActiveFile}
            className={buttonClass('secondary')}
          >
            <FileJson />
            JSON
          </button>
          <button
            type="button"
            onClick={() => void downloadStructuredFormat('yaml')}
            disabled={!hasActiveFile}
            className={buttonClass('secondary')}
          >
            <FileText />
            YAML
          </button>
          <button
            type="button"
            onClick={() => void downloadStructuredFormat('toml')}
            disabled={!hasActiveFile}
            className={buttonClass('secondary')}
          >
            <FileText />
            TOML
          </button>
        </>
      ),
    },
    rtonExport: {
      label: t('toolbar.rtonExport'),
      ariaLabel: t('toolbar.rtonExport'),
      content: (
        <>
          <label className="rton-switch">
            <input
              type="checkbox"
              checked={compactOutput}
              disabled={!hasActiveFile}
              className="rton-switch-input"
              onChange={(event) => {
                const nextCompact = event.currentTarget.checked;
                setCompactOutput(nextCompact);
                refreshOutputBytesForOptions();
              }}
            />
            <span className="rton-switch-label">{t('toolbar.compact')}</span>
            <span className="rton-switch-track" aria-hidden="true" />
          </label>
          <label className="rton-switch">
            <input
              type="checkbox"
              checked={encryptOutput}
              disabled={!hasActiveFile}
              className="rton-switch-input"
              onChange={(event) => {
                const nextEncrypt = event.currentTarget.checked;
                setEncryptOutput(nextEncrypt);
                refreshOutputBytesForOptions();
              }}
            />
            <span className="rton-switch-label">{t('toolbar.encrypted')}</span>
            <span className="rton-switch-track" aria-hidden="true" />
          </label>
	          <button type="button" onClick={validateValue} disabled={!hasActiveFile || !wasmReady} className={buttonClass('secondary')}>
            <CheckCircle2 />
            {t('toolbar.validate')}
          </button>
          <button type="button" onClick={() => void downloadRton()} disabled={!hasActiveFile || !wasmReady} className={buttonClass('primary')}>
            <Download />
            RTON
          </button>
        </>
      ),
    },
    prefs: {
      label: t('toolbar.preferences'),
      ariaLabel: t('toolbar.preferences'),
      content: (
        <>
          <label className="rton-theme-label">
            <span>{t('toolbar.theme')}</span>
            <RtonInlineSelect
              value={themePreference}
              options={themeOptions}
              ariaLabel={t('toolbar.chooseTheme')}
              variant="toolbar"
              className="rton-theme-select"
              onChange={setThemePreference}
            />
          </label>
          <label className="rton-theme-label">
            <span>{t('toolbar.language')}</span>
            <RtonInlineSelect
              value={lang}
              options={languageOptions}
              ariaLabel={t('toolbar.chooseLanguage')}
              variant="toolbar"
              className="rton-theme-select"
              onChange={setLang}
            />
          </label>
          <label className="rton-switch">
            <input
              type="checkbox"
              checked={lineWrapping}
              className="rton-switch-input"
              aria-label={t('toolbar.lineWrap')}
              onChange={(event) => setLineWrapping(event.currentTarget.checked)}
            />
            <span className="rton-switch-label">{t('toolbar.lineWrap')}</span>
            <span className="rton-switch-track" aria-hidden="true" />
          </label>
          <label className="rton-switch">
            <input
              type="checkbox"
              checked={hasActiveFile && editorSearchPanelVisible}
              disabled={!hasActiveFile}
              className="rton-switch-input"
              aria-label={t('toolbar.searchPanel')}
              onChange={(event) => setEditorSearchPanelVisible(event.currentTarget.checked)}
            />
            <span className="rton-switch-label">{t('toolbar.searchPanel')}</span>
            <span className="rton-switch-track" aria-hidden="true" />
          </label>
        </>
      ),
    },
  } satisfies Record<ToolbarGroupId, ToolbarGroupConfig>;

  return (
    <main className="flex h-screen min-h-0 min-w-0 flex-col overflow-hidden bg-[var(--color-bg)] text-[var(--color-text)]">
      <header className="rton-toolbar">
        <DraggableToolbar groups={toolbarGroups} />
          <input
            ref={fileInputRef}
            type="file"
            multiple
            accept={LOADABLE_FILE_ACCEPT}
            className="hidden"
            onChange={(event) => {
              const files = Array.from(event.currentTarget.files ?? []);
              if (files.length > 0) {
                void loadRtonFiles(files);
              }
              event.currentTarget.value = '';
            }}
          />
      </header>

      <div
        className={cx('rton-workspace-shell', dragging && 'outline outline-2 -outline-offset-2 outline-[var(--color-accent-border)]')}
        style={workspaceStyle}
        onDragOver={(event) => {
          event.preventDefault();
          setDragging(true);
        }}
        onDragLeave={() => setDragging(false)}
        onDrop={(event) => {
          event.preventDefault();
          setDragging(false);
          const dataTransfer = event.dataTransfer;
          void (async () => {
            const { entries, containsDirectory } = await collectDroppedEntries(dataTransfer);
            if (entries.length > 0) {
              if (containsDirectory) {
                stageRtonEntries(entries);
              } else {
                await loadRtonEntries(entries);
              }
            }
          })();
        }}
      >
        <EditorTabStrip
          tabs={tabs}
          activeTabId={activeTabId}
          fileName={fileName}
          onActivate={activateEditorTab}
          onClose={closeEditorTab}
          onMove={moveEditorTab}
        />

        <section className="rton-main-content">
          <aside className="rton-side-panel rton-side-panel-left">
          <PanelHeader
            icon={<FileArchive />}
            title={t('fileList.title')}
            subtitle={fileListSubtitle}
            actions={
              <>
                <button type="button" onClick={selectAllListedFiles} disabled={visibleFileCount === 0} className={buttonClass('secondary')}>
                  <CheckCheck />
                  {t('fileList.selectAll')}
                </button>
                <button type="button" onClick={clearSelectedFiles} disabled={selectedVisibleFileCount === 0} className={buttonClass('secondary')}>
                  <Square />
                  {t('fileList.selectNone')}
                </button>
              </>
            }
            below={
              <div className="grid grid-cols-4 gap-1.5">
                {(['rton', 'json', 'yaml', 'toml'] as const).map((mode) => (
                  <button
                    key={mode}
                    type="button"
                    disabled={selectedFileCount === 0 || !wasmReady}
                    className={buttonClass(mode === 'rton' ? 'primary' : 'secondary')}
                    onClick={() => void batchExportSelectedFiles(mode)}
                  >
                    {mode.toUpperCase()}
                  </button>
                ))}
              </div>
            }
          />
          <section className="border-b border-[var(--color-border)] p-2">
            <div className="relative">
              <Search className="pointer-events-none absolute left-2 top-1.5 h-4 w-4 text-[var(--color-text-subtle)]" />
              <input
                type="search"
                value={fileSearchQuery}
                placeholder={t('fileList.searchPlaceholder')}
                disabled={listedFileCount === 0}
                className="h-7 w-full rounded border border-[var(--color-border-strong)] bg-[var(--color-control)] py-0 pl-7 pr-7 text-sm text-[var(--color-text-strong)] placeholder:text-[var(--color-placeholder)] disabled:cursor-not-allowed disabled:opacity-45 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--color-focus)]"
                onChange={(event) => setFileSearchQuery(event.currentTarget.value)}
                onKeyDown={(event) => {
                  if (event.key === 'Escape') {
                    setFileSearchQuery('');
                  }
                }}
              />
              {fileSearchQuery && (
                <button
                  type="button"
                  aria-label={t('fileList.clearSearch')}
                  className="absolute right-1 top-1 grid h-5 w-5 place-items-center rounded border-0 bg-transparent text-[var(--color-text-muted)] hover:bg-[var(--color-border)] hover:text-[var(--color-text-strong)] focus-visible:outline-none"
                  onClick={() => setFileSearchQuery('')}
                >
                  ×
                </button>
              )}
            </div>
          </section>

          <section className="min-h-0 overflow-auto p-2">
            <LoadedFilesTree
              items={filteredLoadedFileItems}
              selectedKeys={selectedFileKeys}
              emptyMessage={fileSearchActive ? t('fileList.noMatches') : t('app.emptyFile')}
              forceOpenFolders={fileSearchActive}
              onOpenFile={openLoadedFile}
              onActivate={activateEditorTab}
              onClose={closeEditorTab}
              onToggleSelected={toggleSelectedFile}
              onToggleSelectedMany={toggleSelectedFiles}
            />
          </section>
        </aside>

        <PanelResizeHandle side="left" width={leftPanelWidth} onResize={resizePanel} />

        <section className="rton-editor-stage">
          {hasActiveFile && editorSurface === 'hex' && displayedHexBytes ? (
	            <HexEditor
	              bytes={displayedHexBytes}
	              jumpTarget={hexJumpTarget}
	              searchPanelVisible={editorSearchPanelVisible}
              onChange={onHexBytesChange}
              onSearchPanelVisibleChange={setEditorSearchPanelVisible}
            />
          ) : hasActiveFile ? (
            <CodeEditor
              value={editorText}
              mode={viewMode}
              lineWrapping={lineWrapping}
              jumpTarget={editorJumpTarget}
              searchPanelVisible={editorSearchPanelVisible}
              onChange={onEditorInput}
              onSearchPanelVisibleChange={setEditorSearchPanelVisible}
            />
          ) : (
            <div className="rton-empty-drop-stage flex h-full min-h-0 flex-col items-center justify-center p-6 text-center">
              <FolderOpen aria-hidden="true" className="mb-3 h-12 w-12 text-[var(--color-accent-text)] opacity-70" />
              <div className="mb-1 max-w-[460px] text-[17px] font-semibold text-[var(--color-drop-hint)]">
                {t('drop.title')}
              </div>
              <div className="text-[13px] text-[var(--color-drop-hint-sub)]">{t('drop.subtitle', { hint: LOADABLE_FILE_HINT })}</div>
            </div>
          )}
        </section>

        <PanelResizeHandle side="right" width={rightPanelWidth} onResize={resizePanel} />

        <aside className="rton-side-panel rton-side-panel-right">
          <div className="shrink-0 border-b border-[var(--color-border)]">
            <PanelHeader icon={<FileArchive />} title={t('panel.fileProperties')} subtitle={t('panel.currentFile')} />
            <section className="border-b border-[var(--color-border)] p-3">
              <dl className="grid gap-3 text-sm">
                <MetaItem label={t('panel.name')} value={displayFileName} />
                <MetaItem label={t('panel.input')} value={hasActiveFile ? (sourceBytes ? formatBytes(sourceBytes.byteLength) : t('app.textInput')) : t('app.noOutput')} />
                <MetaItem label={t('panel.output')} value={outputText} />
              </dl>
            </section>

            <section className="p-3">
              <div className="mb-3 flex items-center gap-2">
                <Activity className="h-4 w-4 text-[var(--color-text-muted)]" />
                <h2 className="text-xs font-semibold uppercase text-[var(--color-text-muted)]">{t('panel.stats')}</h2>
              </div>
              <div className="grid grid-cols-2 gap-2">
                <Stat label={t('panel.nodes')} value={stats.nodes} />
                <Stat label={t('panel.objects')} value={stats.objects} />
                <Stat label={t('panel.arrays')} value={stats.arrays} />
                <Stat label={t('panel.depth')} value={stats.maxDepth} />
              </div>
            </section>
          </div>

          <div className="flex min-h-0 flex-1 flex-col">
            <div className="flex min-h-10 shrink-0 items-center justify-between gap-2 border-b border-[var(--color-border)] bg-[var(--color-surface-raised)] px-2.5 py-2">
              <div className="min-w-0">
                <div className="flex items-center gap-2 text-[var(--color-text-strong)]">
                  <ListTree className="h-4 w-4 text-[var(--color-accent-text)]" />
                  <h2 className="text-sm font-semibold leading-none">{t('panel.index')}</h2>
                </div>
                <p className="mt-1 text-xs text-[var(--color-text-muted)]">RtonValue</p>
              </div>
              <div className="relative min-w-0 max-w-44">
                <Search className="pointer-events-none absolute left-2 top-1.5 h-4 w-4 text-[var(--color-text-subtle)]" />
                <input
                  type="search"
                  value={searchQuery}
                  placeholder={t('panel.search')}
                  disabled={!hasActiveFile}
                  className="h-7 w-full rounded border border-[var(--color-border-strong)] bg-[var(--color-control)] py-0 pl-7 pr-7 text-sm text-[var(--color-text-strong)] placeholder:text-[var(--color-placeholder)] disabled:cursor-not-allowed disabled:opacity-45 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--color-focus)]"
                  onChange={(event) => setSearchQuery(event.currentTarget.value)}
                  onKeyDown={(event) => {
                    if (event.key === 'Escape') {
                      setSearchQuery('');
                    }
                  }}
                />
                {searchQuery && (
                  <button
                    type="button"
                    aria-label={t('panel.clearIndexSearch')}
                    className="absolute right-1 top-1 grid h-5 w-5 place-items-center rounded border-0 bg-transparent text-[var(--color-text-muted)] hover:bg-[var(--color-border)] hover:text-[var(--color-text-strong)] focus-visible:outline-none"
                    onClick={() => setSearchQuery('')}
                  >
                    ×
                  </button>
                )}
              </div>
            </div>
            <div className="min-h-0 overflow-auto">
              <div className="p-3 font-mono text-xs">
                <RtonValueInspector
                  state={searchState}
                  value={currentValue}
                  searchMatchLimit={SEARCH_MATCH_LIMIT}
                  onChange={updateRtonValueNode}
                  onNavigate={navigateToRtonValueNode}
                  onError={(message) => updateStatus(message, 'error')}
                />
              </div>
            </div>
          </div>
        </aside>
        </section>
      </div>

      <footer className="flex min-h-[30px] shrink-0 items-center gap-[14px] overflow-hidden border-t border-[var(--color-border)] bg-[var(--color-status)] px-2.5 py-[5px] text-xs text-[var(--color-status-text)]">
        <span className={cx('min-w-0 flex-1 truncate', status.tone === 'error' && 'text-[var(--color-error)]', status.tone === 'ok' && 'text-[var(--color-accent-text)]')}>
          {status.message}
        </span>
        <span className="hidden shrink-0 tabular-nums text-[var(--color-text-muted)] sm:inline">{displayFileName}</span>
        <span className="hidden shrink-0 tabular-nums text-[var(--color-text-muted)] sm:inline">{t('app.output')} {outputText}</span>
        <a
          href="https://space.bilibili.com/8217621"
          target="_blank"
          rel="noopener noreferrer"
          className="shrink-0 text-[var(--color-status-link)] no-underline hover:text-[var(--color-accent-text)] hover:underline"
        >
          by LambdaEd1th
        </a>
      </footer>
    </main>
  );
}

function runChunkedSearch(
  value: RtonValue,
  query: string,
  searchId: number,
  activeSearchId: MutableRefObject<number>,
  setSearchState: (state: SearchState) => void,
) {
  const matches: SearchMatch[] = [];
  const stack: SearchFrame[] = [{ kind: 'value', value, path: '$', valuePath: [] }];
  let scanned = 0;
  let lastPaint = 0;

  const runChunk = () => {
    if (searchId !== activeSearchId.current) {
      return;
    }

    const started = performance.now();
    while (stack.length > 0 && matches.length < SEARCH_MATCH_LIMIT && performance.now() - started < SEARCH_CHUNK_MS) {
      const frame = stack.pop();
      if (!frame) {
        continue;
      }

      if (frame.kind === 'array') {
        if (frame.index < frame.value.length) {
          const index = frame.index;
          frame.index += 1;
          stack.push(frame);
          stack.push({
            kind: 'value',
            value: frame.value[index],
            path: `${frame.path}[${index}]`,
            valuePath: [...frame.valuePath, { kind: 'array' as const, index }],
          });
        }
        continue;
      }

      if (frame.kind === 'object') {
        if (frame.index < frame.value.length) {
          const entry = frame.value[frame.index];
          const index = frame.index;
          frame.index += 1;
          stack.push(frame);
          stack.push({
            kind: 'value',
            value: entry.value,
            path: childPath(frame.path, entry.key),
            valuePath: [...frame.valuePath, { kind: 'object' as const, index }],
          });
        }
        continue;
      }

      scanned += 1;
      const preview = previewRtonValue(frame.value);
      if (frame.path.toLowerCase().includes(query) || preview.toLowerCase().includes(query)) {
        matches.push({ path: frame.path, preview, valuePath: frame.valuePath });
      }

      if (frame.value.kind === 'array') {
        stack.push({ kind: 'array', value: frame.value.items, path: frame.path, valuePath: frame.valuePath, index: 0 });
      } else if (frame.value.kind === 'object') {
        stack.push({ kind: 'object', value: frame.value.entries, path: frame.path, valuePath: frame.valuePath, index: 0 });
      }
    }

    const done = stack.length === 0;
    const capped = matches.length >= SEARCH_MATCH_LIMIT;
    const now = performance.now();
    if (now - lastPaint > 90 || done || capped) {
      setSearchState({ kind: 'results', query, matches: [...matches], scanned, done, capped });
      lastPaint = now;
    }

    if (!done && !capped) {
      window.setTimeout(runChunk, 0);
    }
  };

  window.setTimeout(runChunk, 0);
}

function collectStats(value: RtonValue): Stats {
  const stats = emptyStats();
  const stack: Array<{ value: RtonValue; depth: number }> = [{ value, depth: 1 }];

  while (stack.length > 0) {
    const item = stack.pop();
    if (!item) {
      continue;
    }

    stats.nodes += 1;
    stats.maxDepth = Math.max(stats.maxDepth, item.depth);
    const current = item.value;

    if (current.kind === 'array') {
      stats.arrays += 1;
      for (let index = current.items.length - 1; index >= 0; index -= 1) {
        stack.push({ value: current.items[index], depth: item.depth + 1 });
      }
    } else if (current.kind === 'object') {
      stats.objects += 1;
      for (let index = current.entries.length - 1; index >= 0; index -= 1) {
        stack.push({ value: current.entries[index].value, depth: item.depth + 1 });
      }
    } else if (current.kind === 'string') {
      stats.strings += 1;
    } else if (current.kind === 'binary') {
      stats.binaries += 1;
    } else if (current.kind === 'rtid') {
      stats.rtids += 1;
    } else if (isRtonNumberKind(current.kind)) {
      stats.numbers += 1;
    } else if (current.kind === 'bool') {
      stats.booleans += 1;
    } else {
      stats.nulls += 1;
    }
  }

  return stats;
}

function emptyStats(): Stats {
  return {
    nodes: 0,
    objects: 0,
    arrays: 0,
    strings: 0,
    numbers: 0,
    booleans: 0,
    nulls: 0,
    rtids: 0,
    binaries: 0,
    maxDepth: 0,
  };
}

function isThemePreference(value: unknown): value is ThemePreference {
  return value === 'system' || value === 'light' || value === 'dark';
}

function readThemePreference(): ThemePreference {
  try {
    const value = localStorage.getItem(THEME_PREFERENCE_KEY);
    return isThemePreference(value) ? value : 'system';
  } catch {
    return 'system';
  }
}

function saveThemePreference(value: ThemePreference) {
  try {
    localStorage.setItem(THEME_PREFERENCE_KEY, value);
  } catch {
    // Ignore unavailable localStorage in restricted browsing contexts.
  }
}

function readLineWrappingPreference() {
  try {
    return localStorage.getItem(LINE_WRAPPING_PREFERENCE_KEY) === 'true';
  } catch {
    return false;
  }
}

function saveLineWrappingPreference(value: boolean) {
  try {
    localStorage.setItem(LINE_WRAPPING_PREFERENCE_KEY, String(value));
  } catch {
    // Ignore unavailable localStorage in restricted browsing contexts.
  }
}

function applyThemePreference(value: ThemePreference) {
  const resolved = value === 'system' ? (window.matchMedia(SYSTEM_DARK_QUERY).matches ? 'dark' : 'light') : value;
  document.documentElement.dataset.theme = resolved;
  document.documentElement.dataset.themePreference = value;
}

function childPath(parent: string, key: string) {
  return /^[A-Za-z_$][\w$]*$/.test(key) ? `${parent}.${key}` : `${parent}[${JSON.stringify(key)}]`;
}

function outputBaseName(fileName: string, extension: string) {
  const leafName = fileName.split(/[\\/]/).pop() ?? fileName;
  const base = leafName.replace(/\.[^.]+$/, '') || 'rton';
  return `${base}.${extension}`;
}

function displayFilePath(file: File) {
  return normalizeDisplayPath(file.webkitRelativePath || file.name) || file.name;
}

function normalizeDisplayPath(path: string) {
  return path.replace(/\\/g, '/').replace(/^\/+/, '');
}

function splitDisplayPath(path: string) {
  return normalizeDisplayPath(path).split('/').filter(Boolean);
}

function buildLoadedFileItems({
  files,
  tabs,
  activeTabId,
  fileName,
  sourceBytes,
  viewMode,
  editorSurface,
  t,
}: {
  files: LoadedRtonFile[];
  tabs: EditorTab[];
  activeTabId: number | null;
  fileName: string;
  sourceBytes: Uint8Array | null;
  viewMode: ViewMode;
  editorSurface: EditorSurface;
  t: Translator;
}): LoadedFileTreeItem[] {
  const tabsById = new Map(tabs.map((tab) => [tab.id, tab]));
  const linkedTabIds = new Set(files.flatMap((file) => (file.tabId === null ? [] : [file.tabId])));
  const fileItems = files.map((file) => {
    const tab = file.tabId === null ? null : (tabsById.get(file.tabId) ?? null);
    const active = tab ? tab.id === activeTabId : false;
    const path = active ? fileName : file.path;
    const parts = splitDisplayPath(path);
    const bytes = active ? sourceBytes : tab?.sourceBytes;
    const mode = active ? viewMode : tab?.viewMode;
    const surface = active ? editorSurface : tab?.editorSurface;
    const kindLabel = loadableFileKindLabel(file.kind);
    return {
      key: `file:${file.id}`,
      fileId: file.id,
      tabId: tab?.id ?? null,
      path,
      name: parts.at(-1) ?? path,
      detail: tab && mode
        ? `${bytes ? formatBytes(bytes.byteLength) : formatBytes(file.file.size)} · ${surface === 'hex' ? 'RTON' : mode.toUpperCase()}`
        : t('fileList.closedDetail', { size: formatBytes(file.file.size), kind: kindLabel }),
      active,
    };
  });
  const tabItems = tabs.filter((tab) => !linkedTabIds.has(tab.id)).map((tab) => {
    const active = tab.id === activeTabId;
    const path = active ? fileName : tab.fileName;
    const parts = splitDisplayPath(path);
    return {
      key: `tab:${tab.id}`,
      fileId: null,
      tabId: tab.id,
      path,
      name: parts.at(-1) ?? path,
      detail: `${active ? (sourceBytes ? formatBytes(sourceBytes.byteLength) : t('app.textInput')) : (tab.sourceBytes ? formatBytes(tab.sourceBytes.byteLength) : t('app.textInput'))} · ${(active ? editorSurface : tab.editorSurface) === 'hex' ? 'RTON' : (active ? viewMode : tab.viewMode).toUpperCase()}`,
      active,
    };
  });
  return [...fileItems, ...tabItems];
}

function filterLoadedFileItems(items: LoadedFileTreeItem[], query: string) {
  const terms = query
    .trim()
    .toLowerCase()
    .split(/\s+/)
    .filter(Boolean);
  if (terms.length === 0) {
    return items;
  }

  return items.filter((item) => {
    const haystack = `${item.path}\n${item.name}\n${item.detail}`.toLowerCase();
    return terms.every((term) => haystack.includes(term));
  });
}

async function collectDirectoryEntries(directoryHandle: FileSystemDirectoryHandle, parentPath = ''): Promise<RtonLoadEntry[]> {
  const entries: RtonLoadEntry[] = [];
  for await (const [name, child] of directoryHandle.entries()) {
    const path = parentPath ? `${parentPath}/${name}` : name;
    if (child.kind === 'file') {
      entries.push({ file: await child.getFile(), path });
    } else {
      entries.push(...await collectDirectoryEntries(child, path));
    }
  }
  return entries;
}

async function collectDroppedEntries(dataTransfer: DataTransfer): Promise<DroppedRtonEntries> {
  const rootEntries = Array.from(dataTransfer.items)
    .filter((item) => item.kind === 'file')
    .map((item) => item.webkitGetAsEntry())
    .filter((entry): entry is FileSystemEntry => Boolean(entry));

  if (rootEntries.length > 0) {
    const nested = await Promise.all(rootEntries.map((entry) => collectFileSystemEntry(entry)));
    return {
      entries: nested.flat(),
      containsDirectory: rootEntries.some((entry) => entry.isDirectory),
    };
  }

  return {
    entries: Array.from(dataTransfer.files).map((file) => ({ file, path: displayFilePath(file) })),
    containsDirectory: false,
  };
}

async function collectFileSystemEntry(entry: FileSystemEntry, parentPath = ''): Promise<RtonLoadEntry[]> {
  const path = parentPath ? `${parentPath}/${entry.name}` : entry.name;
  if (entry.isFile) {
    return [{ file: await readFileEntry(entry as FileSystemFileEntry), path }];
  }

  const childEntries = await readAllDirectoryEntries((entry as FileSystemDirectoryEntry).createReader());
  const nested = await Promise.all(childEntries.map((child) => collectFileSystemEntry(child, path)));
  return nested.flat();
}

function readFileEntry(entry: FileSystemFileEntry): Promise<File> {
  return new Promise((resolve, reject) => entry.file(resolve, reject));
}

async function readAllDirectoryEntries(reader: FileSystemDirectoryReader): Promise<FileSystemEntry[]> {
  const entries: FileSystemEntry[] = [];
  while (true) {
    const batch = await new Promise<FileSystemEntry[]>((resolve, reject) => reader.readEntries(resolve, reject));
    if (batch.length === 0) {
      return entries;
    }
    entries.push(...batch);
  }
}

function detectLoadableFileKind(file: File, allowFallback: boolean): LoadableFileKind | null {
  if (/\.(?:rton|dat)$/i.test(file.name)) {
    return 'rton';
  }
  if (/\.json$/i.test(file.name)) {
    return 'json';
  }
  if (/\.ya?ml$/i.test(file.name)) {
    return 'yaml';
  }
  if (/\.toml$/i.test(file.name)) {
    return 'toml';
  }
  return allowFallback ? 'rton' : null;
}

function loadableFileKindLabel(kind: LoadableFileKind) {
  return kind.toUpperCase();
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

function sameRtonEncoding(left: RtonBinaryEncoding, right: RtonBinaryEncoding) {
  return left.compact === right.compact && left.encrypted === right.encrypted;
}

function formatRtonEncoding(encoding: RtonBinaryEncoding, t?: Translator) {
  const encryptedLabel = t ? t('toolbar.encrypted') : translate('toolbar.encrypted');
  return `${encoding.compact ? 'Compact' : 'Standard'}${encoding.encrypted ? ` · ${encryptedLabel}` : ''}`;
}

function parseJsonTextToRtonValue(json: string) {
  return decodeRtonValueWire(json_text_to_value(json));
}

function rtonValueToJsonText(value: RtonValue, pretty: boolean) {
  return value_to_json_text(encodeRtonValueWire(value), pretty);
}

function encodeRtonOutputBytes(value: RtonValue, compact: boolean, encrypted: boolean) {
  const bytes = encode_value_to_rton(encodeRtonValueWire(value), compact);
  return encrypted ? encrypt_rton_data(bytes) : bytes;
}

function jsonPreviewUnavailableText(message: string, t: Translator = translate) {
  return t('format.previewUnavailableText', { label: 'JSON', message });
}

function isPendingTextPreview(text: string) {
  return text === translate('format.generatingPreviewText', { label: 'JSON' })
    || text === translate('format.generatingPreviewText', { label: 'YAML' })
    || text === translate('format.generatingPreviewText', { label: 'TOML' })
    || (text.startsWith('正在后台生成 ') && text.endsWith(' 预览...'))
    || (text.startsWith('Generating ') && text.endsWith(' preview in the background...'));
}

function rtonValueToJsonValue(value: RtonValue) {
  return rtonValueToPlain(value) as JsonValue;
}

function decodeRtonSourceValue(bytes: Uint8Array, renderJsonPreview = true, t: Translator = translate) {
  const encrypted = isEncryptedRtonBytes(bytes);
  const plainBytes = encrypted ? decrypt_rton_data(bytes) : bytes;
  const compact = isCompactRtonBytes(plainBytes);
  const wire = decode_rton_to_value(plainBytes);
  let editorText: string;
  let surfaceNote: string;
  if (renderJsonPreview) {
    try {
      editorText = value_to_json_text(wire, true);
      surfaceNote = t('format.jsonEditable');
    } catch (error) {
      editorText = jsonPreviewUnavailableText(errorMessage(error), t);
      surfaceNote = t('format.jsonPreviewUnavailable');
    }
  } else {
    editorText = '';
    surfaceNote = t('format.jsonNotGenerated');
  }

  return {
    value: decodeRtonValueWire(wire),
    editorText,
	    surfaceNote,
	    compact,
	    encrypted,
	  };
}

async function decodeLoadableSource(
  candidate: LoadableFileCandidate,
  preferredViewMode: ViewMode = 'json',
  preferredEditorSurface: EditorSurface = 'hex',
  t: Translator = translate,
) {
  if (candidate.kind === 'rton') {
    const bytes = new Uint8Array(await candidate.file.arrayBuffer());
    const useHexSurface = preferredEditorSurface === 'hex';
	    const { value, encrypted, compact } = decodeRtonSourceValue(bytes, false, t);
	    const binaryEncoding = { compact, encrypted };
    const label = loadableFileKindLabel(preferredViewMode);
    const editorText = useHexSurface ? '' : t('format.generatingPreviewText', { label });
    const textSurfaceNote = useHexSurface ? t('app.notGenerated') : t('format.generatingPreview', { label });
    if (preferredViewMode === 'json') {
      return {
        value,
        editorText,
        surfaceNote: useHexSurface ? t('format.rtonEditable') : textSurfaceNote,
	        sourceBytes: bytes,
	        binaryBytes: bytes,
	        binaryEncoding,
	        viewMode: 'json' as const,
        editorSurface: useHexSurface ? ('hex' as const) : ('text' as const),
        status: { message: encrypted ? t('status.encryptedRtonParsed') : t('format.parsed', { label: 'RTON' }), tone: 'ok' as const },
        needsTextPreview: !useHexSurface,
      };
    }

	    let preferredEditorText: string;
	    let preferredSurfaceNote: string;
	    if (useHexSurface) {
	      preferredEditorText = '';
	      preferredSurfaceNote = t('app.notGenerated');
	    } else {
	      preferredEditorText = editorText;
	      preferredSurfaceNote = textSurfaceNote;
	    }

    return {
      value,
      editorText: preferredEditorText,
      surfaceNote: useHexSurface ? t('format.rtonEditable') : preferredSurfaceNote,
	      sourceBytes: bytes,
	      binaryBytes: bytes,
	      binaryEncoding,
		      viewMode: preferredViewMode,
	      editorSurface: useHexSurface ? ('hex' as const) : ('text' as const),
	      status: { message: encrypted ? t('status.encryptedRtonParsed') : t('format.parsed', { label: 'RTON' }), tone: 'ok' as const },
	      needsTextPreview: !useHexSurface,
	    };
  }

  const text = await candidate.file.text();
  if (candidate.kind === 'json') {
    return {
      value: parseJsonTextToRtonValue(text),
      editorText: text,
      surfaceNote: t('format.jsonEditable'),
	      sourceBytes: null,
	      binaryBytes: null,
	      binaryEncoding: null,
	      viewMode: 'json' as const,
      editorSurface: 'text' as const,
      status: { message: t('format.parsed', { label: 'JSON' }), tone: 'ok' as const },
    };
  }

  const { parseStructuredText } = await import('./format-conversion');
  const { value } = parseStructuredText(text, candidate.kind);
  const label = loadableFileKindLabel(candidate.kind);
  return {
    value,
    editorText: text,
    surfaceNote: t('format.editable', { label }),
	    sourceBytes: null,
	    binaryBytes: null,
	    binaryEncoding: null,
	    viewMode: candidate.kind,
    editorSurface: 'text' as const,
    status: { message: t('format.parsed', { label }), tone: 'ok' as const },
  };
}

function collectLoadableCandidates(entries: RtonLoadEntry[], allowSingleFallback: boolean): LoadableFileCandidate[] {
  const allowFallback = allowSingleFallback && entries.length === 1;
  return entries.flatMap((entry) => {
    const kind = detectLoadableFileKind(entry.file, allowFallback);
    return kind ? [{ ...entry, kind }] : [];
  });
}

function clampPanelWidth(width: number) {
  return Math.round(Math.min(PANEL_MAX_WIDTH, Math.max(PANEL_MIN_WIDTH, width)));
}

function downloadBlob(data: BlobPart | Blob, name: string, type = 'application/json') {
  const blob = data instanceof Blob ? data : new Blob([data], { type });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = name;
  link.click();
  URL.revokeObjectURL(url);
}

function downloadBytes(bytes: Uint8Array, name: string) {
  const buffer = new ArrayBuffer(bytes.byteLength);
  new Uint8Array(buffer).set(bytes);
  downloadBlob(new Blob([buffer], { type: 'application/octet-stream' }), name);
}

async function resolveBatchItemValue(
  item: LoadedFileTreeItem,
  context: {
    activeTabId: number | null;
    currentValue: RtonValue | null;
    filesById: Map<number, LoadedRtonFile>;
    tabsById: Map<number, EditorTab>;
  },
) {
  if (item.tabId !== null) {
    const value = item.tabId === context.activeTabId ? context.currentValue : context.tabsById.get(item.tabId)?.currentValue;
    if (value) {
      return value;
    }
  }

  if (item.fileId !== null) {
    const entry = context.filesById.get(item.fileId);
    if (!entry) {
      throw new Error(translate('status.fileListItemStale'));
    }
    return (await decodeLoadableSource(entry)).value;
  }

  throw new Error(translate('status.noExportValue'));
}

function convertRtonValueForBatch(
  value: RtonValue,
  mode: BatchExportMode,
  options: {
    compact: boolean;
    encrypted: boolean;
    structuredFormatter: StructuredFormatter | null;
  },
) {
  if (mode === 'rton') {
    return encodeRtonOutputBytes(value, options.compact, options.encrypted);
  }

  const encoder = new TextEncoder();
  if (mode === 'json') {
    return encoder.encode(rtonValueToJsonText(value, true));
  }

  if (!options.structuredFormatter) {
    throw new Error(`${mode.toUpperCase()} formatter is unavailable`);
  }
  return encoder.encode(options.structuredFormatter(value, mode));
}

function batchOutputPath(path: string, mode: BatchExportMode, _compact: boolean, _encrypted: boolean) {
  const base = stripKnownRtonExtension(path.replace(/\\/g, '/'));
  if (mode === 'rton') {
    return `${base}.rton`;
  }
  return `${base}.${mode}`;
}

function stripKnownRtonExtension(path: string) {
  return path.replace(/\.(?:rton|dat|json|ya?ml|toml)$/i, '') || 'rton';
}

function uniqueZipPath(path: string, usedPaths: Set<string>) {
  const cleanPath = path.replace(/^\/+/, '').replace(/\/+/g, '/');
  if (!usedPaths.has(cleanPath)) {
    usedPaths.add(cleanPath);
    return cleanPath;
  }

  const slashIndex = cleanPath.lastIndexOf('/');
  const directory = slashIndex === -1 ? '' : `${cleanPath.slice(0, slashIndex + 1)}`;
  const leaf = slashIndex === -1 ? cleanPath : cleanPath.slice(slashIndex + 1);
  const dotIndex = leaf.lastIndexOf('.');
  const stem = dotIndex === -1 ? leaf : leaf.slice(0, dotIndex);
  const extension = dotIndex === -1 ? '' : leaf.slice(dotIndex);
  for (let index = 2; ; index += 1) {
    const candidate = `${directory}${stem}-${index}${extension}`;
    if (!usedPaths.has(candidate)) {
      usedPaths.add(candidate);
      return candidate;
    }
  }
}

function createZipArchive(entries: ZipFileEntry[]) {
  const encoder = new TextEncoder();
  const localParts: Uint8Array[] = [];
  const centralParts: Uint8Array[] = [];
  let offset = 0;

  for (const entry of entries) {
    const nameBytes = encoder.encode(entry.path);
    const crc = crc32(entry.bytes);
    assertZipUint32(entry.bytes.byteLength, 'ZIP entry is too large');
    assertZipUint32(offset, 'ZIP archive is too large');

    const localHeader = new Uint8Array(30 + nameBytes.byteLength);
    const localView = new DataView(localHeader.buffer);
    writeZipU32(localView, 0, 0x04034b50);
    writeZipU16(localView, 4, 20);
    writeZipU16(localView, 6, 0x0800);
    writeZipU16(localView, 8, 0);
    writeZipU16(localView, 10, zipDosTime());
    writeZipU16(localView, 12, zipDosDate());
    writeZipU32(localView, 14, crc);
    writeZipU32(localView, 18, entry.bytes.byteLength);
    writeZipU32(localView, 22, entry.bytes.byteLength);
    writeZipU16(localView, 26, nameBytes.byteLength);
    localHeader.set(nameBytes, 30);
    localParts.push(localHeader, entry.bytes);

    const centralHeader = new Uint8Array(46 + nameBytes.byteLength);
    const centralView = new DataView(centralHeader.buffer);
    writeZipU32(centralView, 0, 0x02014b50);
    writeZipU16(centralView, 4, 20);
    writeZipU16(centralView, 6, 20);
    writeZipU16(centralView, 8, 0x0800);
    writeZipU16(centralView, 10, 0);
    writeZipU16(centralView, 12, zipDosTime());
    writeZipU16(centralView, 14, zipDosDate());
    writeZipU32(centralView, 16, crc);
    writeZipU32(centralView, 20, entry.bytes.byteLength);
    writeZipU32(centralView, 24, entry.bytes.byteLength);
    writeZipU16(centralView, 28, nameBytes.byteLength);
    writeZipU32(centralView, 42, offset);
    centralHeader.set(nameBytes, 46);
    centralParts.push(centralHeader);

    offset += localHeader.byteLength + entry.bytes.byteLength;
  }

  const centralOffset = offset;
  const centralSize = byteLengthOf(centralParts);
  assertZipUint32(centralOffset, 'ZIP archive is too large');
  assertZipUint32(centralSize, 'ZIP central directory is too large');

  const end = new Uint8Array(22);
  const endView = new DataView(end.buffer);
  writeZipU32(endView, 0, 0x06054b50);
  writeZipU16(endView, 8, entries.length);
  writeZipU16(endView, 10, entries.length);
  writeZipU32(endView, 12, centralSize);
  writeZipU32(endView, 16, centralOffset);
  return concatBytes([...localParts, ...centralParts, end]);
}

function byteLengthOf(parts: Uint8Array[]) {
  return parts.reduce((total, part) => total + part.byteLength, 0);
}

function concatBytes(parts: Uint8Array[]) {
  const total = byteLengthOf(parts);
  const out = new Uint8Array(total);
  let offset = 0;
  for (const part of parts) {
    out.set(part, offset);
    offset += part.byteLength;
  }
  return out;
}

function writeZipU16(view: DataView, offset: number, value: number) {
  view.setUint16(offset, value, true);
}

function writeZipU32(view: DataView, offset: number, value: number) {
  view.setUint32(offset, value >>> 0, true);
}

function assertZipUint32(value: number, message: string) {
  if (value > 0xffffffff) {
    throw new Error(message);
  }
}

function zipDosTime(date = new Date()) {
  return (date.getHours() << 11) | (date.getMinutes() << 5) | Math.floor(date.getSeconds() / 2);
}

function zipDosDate(date = new Date()) {
  return ((date.getFullYear() - 1980) << 9) | ((date.getMonth() + 1) << 5) | date.getDate();
}

let crc32Table: Uint32Array | null = null;

function crc32(bytes: Uint8Array) {
  const table = crc32Table ?? (crc32Table = createCrc32Table());
  let crc = 0xffffffff;
  for (const byte of bytes) {
    crc = (crc >>> 8) ^ table[(crc ^ byte) & 0xff];
  }
  return (crc ^ 0xffffffff) >>> 0;
}

function createCrc32Table() {
  const table = new Uint32Array(256);
  for (let index = 0; index < table.length; index += 1) {
    let value = index;
    for (let bit = 0; bit < 8; bit += 1) {
      value = value & 1 ? 0xedb88320 ^ (value >>> 1) : value >>> 1;
    }
    table[index] = value >>> 0;
  }
  return table;
}

function timestampForFileName() {
  const now = new Date();
  const pad = (value: number) => String(value).padStart(2, '0');
  return `${now.getFullYear()}${pad(now.getMonth() + 1)}${pad(now.getDate())}-${pad(now.getHours())}${pad(now.getMinutes())}${pad(now.getSeconds())}`;
}

function yieldToBrowser() {
  return new Promise<void>((resolve) => window.setTimeout(resolve, 0));
}

function formatBytes(bytes: number) {
  if (bytes < 1024) {
    return `${bytes} B`;
  }
  if (bytes < 1024 * 1024) {
    return `${(bytes / 1024).toFixed(1)} KB`;
  }
  return `${(bytes / 1024 / 1024).toFixed(2)} MB`;
}

function errorMessage(error: unknown) {
  return error instanceof Error ? error.message : String(error);
}

function isDirectoryPickerGestureError(error: unknown) {
  return errorMessage(error).toLowerCase().includes('user gesture');
}

function cx(...classes: Array<string | false | null | undefined>) {
  return classes.filter(Boolean).join(' ');
}

function buttonClass(variant: 'primary' | 'secondary', icon = false) {
  return cx(
    buttonBase,
    variant === 'primary' && 'border-[var(--color-accent-border)] bg-[var(--color-accent)] font-semibold text-[var(--color-accent-contrast)] hover:bg-[var(--color-accent-strong)]',
    variant === 'secondary' && 'border-[var(--color-border-strong)] bg-[var(--color-control)] text-[var(--color-text-strong)] hover:border-[var(--color-border-stronger)] hover:bg-[var(--color-control-hover)]',
    icon && 'w-7 px-0',
    '[&>svg]:h-4 [&>svg]:w-4',
  );
}

function modeButtonClass(active: boolean) {
  return cx(
    'inline-flex h-7 min-w-14 items-center justify-center rounded border px-2 text-[13px] font-semibold leading-none transition-colors disabled:cursor-not-allowed disabled:opacity-45 focus-visible:outline-none',
    active
      ? 'border-[var(--color-accent-border)] bg-[var(--color-control-active)] text-[var(--color-accent-text)]'
      : 'border-[var(--color-border-strong)] bg-[var(--color-control)] text-[var(--color-text)] hover:bg-[var(--color-control-hover)]',
  );
}

function createEditorTabFromValue({
  id,
  fileName,
  value,
  editorText,
  surfaceNote,
	  sourceBytes,
	  binaryBytes,
	  binaryEncoding,
	  viewMode = 'json',
  editorSurface = 'text',
  status,
}: {
  id: number;
  fileName: string;
  value: RtonValue;
  editorText?: string;
  surfaceNote?: string;
	  sourceBytes: Uint8Array | null;
	  binaryBytes?: Uint8Array | null;
	  binaryEncoding?: RtonBinaryEncoding | null;
	  viewMode?: ViewMode;
  editorSurface?: EditorSurface;
  status: StatusState;
}, t: Translator = translate): EditorTab {
  try {
	    const plainValue = rtonValueToJsonValue(value);
	    const actualBinaryBytes = binaryBytes ?? sourceBytes;
	    let text = editorText;
    let note = surfaceNote ?? t('format.editable', { label: viewMode.toUpperCase() });
    if (text === undefined) {
      try {
        text = rtonValueToJsonText(value, true);
      } catch (error) {
        text = jsonPreviewUnavailableText(errorMessage(error), t);
        note = t('format.jsonPreviewUnavailable');
      }
    }

    return {
      id,
	      fileName,
	      sourceBytes,
	      binaryBytes: actualBinaryBytes,
	      binaryEncoding: actualBinaryBytes ? binaryEncoding ?? null : null,
	      currentValue: value,
      editorText: text,
      lastOutputBytes: null,
      parsedJson: plainValue,
      parseError: null,
      stats: collectStats(value),
      viewMode,
	      editorSurface: editorSurface === 'hex' && actualBinaryBytes ? 'hex' : 'text',
      surfaceNote: note,
      searchQuery: '',
      searchState: { kind: 'idle' },
      status,
    };
  } catch (error) {
	    const message = errorMessage(error);
	    const actualBinaryBytes = binaryBytes ?? sourceBytes;
	    return {
      id,
	      fileName,
	      sourceBytes,
	      binaryBytes: actualBinaryBytes,
	      binaryEncoding: actualBinaryBytes ? binaryEncoding ?? null : null,
	      currentValue: value,
      editorText: editorText ?? '',
      lastOutputBytes: null,
      parsedJson: null,
      parseError: message,
      stats: emptyStats(),
      viewMode,
	      editorSurface: editorSurface === 'hex' && actualBinaryBytes ? 'hex' : 'text',
      surfaceNote: surfaceNote ?? t('format.parseFailed', { label: viewMode.toUpperCase(), message }),
      searchQuery: '',
      searchState: { kind: 'message', message },
      status: { message, tone: 'error' },
    };
  }
}
