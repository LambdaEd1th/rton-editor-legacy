import {
  useCallback,
  useEffect,
  useId,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
  type DragEvent as ReactDragEvent,
  type KeyboardEvent as ReactKeyboardEvent,
  type MouseEvent as ReactMouseEvent,
  type MutableRefObject,
  type PointerEvent as ReactPointerEvent,
  type ReactNode,
} from 'react';
import { createPortal } from 'react-dom';
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
  GripVertical,
  ListTree,
  Search,
  Square,
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
import { HexEditor, type HexEditorJumpTarget } from './components/HexEditor';
import type { StructuredFormatMode } from './format-conversion';
import {
  decodeRtonValueWire,
  encodeRtonValueWire,
  rtonValueToPlain,
  type RtonIntegerKind,
  type RtonValue,
} from './rton-value';
import { sampleJson } from './sample';
import { locateRtonValueOffset } from './rton-offset-map';

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
type PanelSide = 'left' | 'right';
type DropPlacement = 'before' | 'after';
type DropMarker<T extends string | number> = { id: T; placement: DropPlacement };
type ToolbarGroupId = 'file' | 'format' | 'textExport' | 'rtonExport' | 'prefs';
type ToolbarRows = ToolbarGroupId[][];
type ToolbarDropTarget =
  | { type: 'group'; id: ToolbarGroupId; placement: DropPlacement }
  | { type: 'row-end'; rowIndex: number };
type RtonValuePathSegment = { kind: 'array'; index: number } | { kind: 'object'; index: number };
type RtonValuePath = RtonValuePathSegment[];

type ToolbarGroupConfig = {
  label: string;
  content: ReactNode;
  role?: string;
  ariaLabel?: string;
};
type RtonInlineSelectOption<T extends string> = { value: T; label: string };

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

type SearchMatch = {
  path: string;
  preview: string;
  valuePath: RtonValuePath;
};

type SearchState =
  | { kind: 'idle' }
  | { kind: 'message'; message: string }
  | { kind: 'results'; query: string; matches: SearchMatch[]; scanned: number; done: boolean; capped: boolean };

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

type LoadedFileTreeItem = {
  key: string;
  fileId: number | null;
  tabId: number | null;
  path: string;
  name: string;
  detail: string;
  active: boolean;
};

type LoadedFileTreeNode =
  | { kind: 'folder'; name: string; path: string; count: number; children: LoadedFileTreeNode[] }
  | { kind: 'file'; name: string; item: LoadedFileTreeItem };

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
      target: RtonBinaryEncoding;
      ok: true;
      bytes: Uint8Array;
      elapsedMs: number;
    }
  | {
      id: number;
      target: RtonBinaryEncoding;
      ok: false;
      error: string;
    };

type ByteTransformState = {
  status: 'idle' | 'running' | 'ready' | 'error';
  target: RtonBinaryEncoding | null;
  bytes: Uint8Array | null;
  elapsedMs: number | null;
  error: string | null;
};

type SearchFrame =
  | { kind: 'value'; value: RtonValue; path: string; valuePath: RtonValuePath }
  | { kind: 'array'; value: RtonValue[]; path: string; valuePath: RtonValuePath; index: number }
  | { kind: 'object'; value: Array<{ key: string; value: RtonValue }>; path: string; valuePath: RtonValuePath; index: number };

const TREE_CHILD_LIMIT = 160;
const SEARCH_MATCH_LIMIT = 120;
const SEARCH_CHUNK_MS = 10;
const SEARCH_DEBOUNCE_MS = 140;
const EDITOR_PARSE_DEBOUNCE_MS = 450;
const FORMAT_WORKER_TIMEOUT_MS = 20_000;
const EMPTY_FILE_NAME = '未打开文件';
const EMPTY_SURFACE_NOTE = '等待文件';
const EMPTY_SEARCH_MESSAGE = '未打开文件';
const LEFT_PANEL_DEFAULT_WIDTH = 300;
const RIGHT_PANEL_DEFAULT_WIDTH = 380;
const PANEL_MIN_WIDTH = 220;
const PANEL_MAX_WIDTH = 560;
const TOOLBAR_LAYOUT_KEY = 'rton-editor-toolbar-layout';
const THEME_PREFERENCE_KEY = 'rton-editor-theme-preference';
const LINE_WRAPPING_PREFERENCE_KEY = 'rton-editor-line-wrapping';
const SYSTEM_DARK_QUERY = '(prefers-color-scheme: dark)';
const TOOLBAR_GROUP_IDS: ToolbarGroupId[] = ['file', 'format', 'textExport', 'rtonExport', 'prefs'];
const LOADABLE_FILE_ACCEPT =
  '.rton,.dat,.json,.yaml,.yml,.toml,application/octet-stream,application/json,application/yaml,text/yaml,application/toml,text/toml,text/plain';
const LOADABLE_FILE_HINT = '.rton / .dat / .json / .yaml / .yml / .toml';
const DEFAULT_TOOLBAR_ROWS: ToolbarRows = [
  ['file', 'format'],
  ['textExport', 'rtonExport', 'prefs'],
];
const THEME_OPTIONS: Array<RtonInlineSelectOption<ThemePreference>> = [
  { value: 'system', label: '跟随系统' },
  { value: 'light', label: '浅色' },
  { value: 'dark', label: '深色' },
];

const buttonBase =
  'inline-flex h-7 min-w-0 shrink-0 items-center justify-center gap-1 whitespace-nowrap rounded border px-2.5 text-[13px] leading-none transition-colors focus-visible:outline-none disabled:cursor-not-allowed disabled:opacity-45';

if (typeof window !== 'undefined' && typeof document !== 'undefined') {
  applyThemePreference(readThemePreference());
}

export function App() {
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
  const [surfaceNote, setSurfaceNote] = useState(EMPTY_SURFACE_NOTE);
  const [status, setStatus] = useState<StatusState>({ message: 'wasm 初始化中', tone: 'warn' });
  const [fileSearchQuery, setFileSearchQuery] = useState('');
  const [searchQuery, setSearchQuery] = useState('');
  const [searchState, setSearchState] = useState<SearchState>({ kind: 'message', message: EMPTY_SEARCH_MESSAGE });
  const [dragging, setDragging] = useState(false);
  const [leftPanelWidth, setLeftPanelWidth] = useState(LEFT_PANEL_DEFAULT_WIDTH);
  const [rightPanelWidth, setRightPanelWidth] = useState(RIGHT_PANEL_DEFAULT_WIDTH);
  const [themePreference, setThemePreference] = useState<ThemePreference>(() => readThemePreference());
  const [lineWrapping, setLineWrapping] = useState(() => readLineWrappingPreference());
  const [editorSearchPanelVisible, setEditorSearchPanelVisible] = useState(false);
  const [byteTransformState, setByteTransformState] = useState<ByteTransformState>({
    status: 'idle',
    target: null,
    bytes: null,
    elapsedMs: null,
    error: null,
  });

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
        setEditorTextState(`${label} 预览不可用\n\n${message}`);
        setSurfaceNote(`${label} 预览不可用`);
        updateStatus(`${label} 预览失败：${message}`, 'error');
      } else {
        const parseMessage = `${label} 解析失败：${message}`;
        setParseError(parseMessage);
        setSearchState({ kind: 'message', message: parseMessage });
        setSurfaceNote(`${label} 解析失败`);
        updateStatus(parseMessage, 'error');
      }
    },
    [terminateFormatWorker, updateStatus],
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
        const actionText = action === 'format' ? '生成预览' : '解析';
        handleFormatWorkerFailure(`${label} ${actionText}超时，已停止后台任务。这个文件可能过大，或当前格式转换库处理该结构太慢。`);
      }, FORMAT_WORKER_TIMEOUT_MS);
    },
    [clearFormatTimeout, handleFormatWorkerFailure],
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

  const resetByteTransformState = useCallback(() => {
    setByteTransformState({
      status: 'idle',
      target: null,
      bytes: null,
      elapsedMs: null,
      error: null,
    });
  }, []);

  const terminateByteTransformWorker = useCallback(() => {
    byteTransformRequestId.current += 1;
    if (byteTransformWorker.current) {
      byteTransformWorker.current.terminate();
      byteTransformWorker.current = null;
    }
  }, []);

  const getByteTransformWorker = useCallback(() => {
    if (!byteTransformWorker.current) {
      byteTransformWorker.current = new Worker(new URL('./byte-transform-worker.ts', import.meta.url), { type: 'module' });
      byteTransformWorker.current.addEventListener('message', (event: MessageEvent<ByteTransformWorkerResponse>) => {
        const response = event.data;
        if (response.id !== byteTransformRequestId.current) {
          return;
        }

        if (response.ok) {
          const label = formatRtonEncoding(response.target);
          setByteTransformState({
            status: 'ready',
            target: response.target,
            bytes: response.bytes,
            elapsedMs: response.elapsedMs,
            error: null,
          });
          updateStatus(`${label} Hex 已生成，用时 ${formatDuration(response.elapsedMs)}`, 'ok');
        } else {
          const label = formatRtonEncoding(response.target);
          setByteTransformState({
            status: 'error',
            target: response.target,
            bytes: null,
            elapsedMs: null,
            error: response.error,
          });
          updateStatus(`${label} Hex 生成失败：${response.error}`, 'error');
        }
      });
      byteTransformWorker.current.addEventListener('error', (event) => {
        event.preventDefault();
        const message = event instanceof ErrorEvent && event.message ? event.message : 'Hex 转换 worker 出错';
        setByteTransformState((current) => ({
          status: 'error',
          target: current.target,
          bytes: null,
          elapsedMs: null,
          error: message,
        }));
        updateStatus(message, 'error');
      });
      byteTransformWorker.current.addEventListener('messageerror', () => {
        const message = 'Hex 转换 worker 返回了无法读取的数据';
        setByteTransformState((current) => ({
          status: 'error',
          target: current.target,
          bytes: null,
          elapsedMs: null,
          error: message,
        }));
        updateStatus(message, 'error');
      });
    }
    return byteTransformWorker.current;
  }, [updateStatus]);

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
      setSurfaceNote(EMPTY_SURFACE_NOTE);
      setSearchQuery('');
      setSearchState({ kind: 'message', message: EMPTY_SEARCH_MESSAGE });
      setEditorSearchPanelVisible(false);
      setStatus(nextStatus);
    },
    [clearPendingWork, setCurrentValueState],
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
        restoreEmptyWorkspace({ message: '没有打开的文件', tone: 'warn' });
        return;
      }

      setTabs(nextTabs);
      if (tabId === activeTabId) {
        const nextActive = syncedTabs[closeIndex + 1] ?? syncedTabs[closeIndex - 1] ?? nextTabs[0];
        restoreEditorTab(nextActive);
      }
    },
    [activeTabId, restoreEditorTab, restoreEmptyWorkspace, syncActiveTab],
  );

  const moveEditorTab = useCallback(
    (tabId: number, targetTabId: number, placement: DropPlacement) => {
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
        updateStatus('wasm 仍在初始化', 'warn');
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
          setSurfaceNote(`${viewModeRef.current.toUpperCase()} 可编辑`);
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
    [clearParseTimer, setCurrentValueState, updateStatus, wasmReady],
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
	          setSurfaceNote(response.truncated ? `${label} 预览已截断` : `${label} 可编辑`);
	          updateStatus(response.truncated ? `${label} 预览已生成并截断` : `${label} 已生成`, response.truncated ? 'warn' : 'ok');
	        } else if (response.ok && response.action === 'parse') {
          const plainValue = response.plainValue as JsonValue;
          setCurrentValueState(response.value);
          setParsedJson(plainValue);
          setParseError(null);
          setStats(collectStats(response.value));
          setSearchState({ kind: 'idle' });
          setSurfaceNote(`${label} 可编辑`);
          updateStatus(`${label} 已解析`, 'ok');
        } else if (!response.ok && response.action === 'format') {
          setEditorTextState(`${label} 预览不可用\n\n${response.error}`);
          setSurfaceNote(`${label} 预览不可用`);
          updateStatus(`${label} 预览失败：${response.error}`, 'error');
        } else if (!response.ok && response.action === 'parse') {
          const message = `${label} 解析失败：${response.error}`;
          setCurrentValueState(null);
          setParseError(message);
          setSearchState({ kind: 'message', message });
          setSurfaceNote(`${label} 解析失败`);
	          updateStatus(message, 'error');
	        }
	      });
	      formatWorker.current.addEventListener('error', (event) => {
	        event.preventDefault();
	        handleFormatWorkerFailure(event instanceof ErrorEvent && event.message ? event.message : '后台格式化 worker 出错');
	      });
	      formatWorker.current.addEventListener('messageerror', () => {
	        handleFormatWorkerFailure('后台格式化 worker 返回了无法读取的数据');
	      });
	    }
	
	    return formatWorker.current;
	  }, [clearFormatTimeout, handleFormatWorkerFailure, setCurrentValueState, updateStatus]);

	  const renderTextForValue = useCallback(
	    (value: RtonValue, mode: ViewMode) => {
	      const requestId = beginFormatWorkerRequest('format', mode);
	      const label = mode.toUpperCase();
	      setSurfaceNote(`正在生成 ${label} 预览`);
	      setEditorTextState(`正在后台生成 ${label} 预览...`);
	      scheduleFormatWorkerTimeout(requestId, mode, 'format');
	      getFormatWorker().postMessage({
	        action: 'format',
	        id: requestId,
        value,
        mode,
	      });
	      return true;
	    },
	    [beginFormatWorkerRequest, getFormatWorker, scheduleFormatWorkerTimeout],
	  );
	
	  const renderAlternateFormat = useCallback(
	    (mode: Exclude<ViewMode, 'json'>) => {
	      const label = mode.toUpperCase();
	      setSurfaceNote(`正在生成 ${label} 预览`);
	
	      if (parseError) {
	        invalidateFormatWork();
	        setEditorTextState(`${label} 预览不可用\n\n当前内容无法解析：${parseError}`);
	        setSurfaceNote(`${label} 预览不可用`);
	        return;
      }
	
	      const value = currentValueRef.current;
	      if (!value) {
	        invalidateFormatWork();
	        setEditorTextState(`${label} 预览不可用\n\n当前内容还没有可用的 RTON Value`);
	        setSurfaceNote(`${label} 预览不可用`);
	        return;
	      }
	
	      const requestId = beginFormatWorkerRequest('format', mode);
	      setEditorTextState(`正在后台生成 ${label} 预览...`);
	      scheduleFormatWorkerTimeout(requestId, mode, 'format');
	      getFormatWorker().postMessage({
	        action: 'format',
	        id: requestId,
        value,
        mode,
	      });
	    },
	    [beginFormatWorkerRequest, getFormatWorker, invalidateFormatWork, parseError, scheduleFormatWorkerTimeout],
	  );
	
	  const parseAlternateFormat = useCallback(
	    (mode: Exclude<ViewMode, 'json'>, text: string) => {
	      clearParseTimer();
	      const requestId = beginFormatWorkerRequest('parse', mode);
	      const label = mode.toUpperCase();
	      setSurfaceNote(`正在解析 ${label}`);
	      scheduleFormatWorkerTimeout(requestId, mode, 'parse');
	      getFormatWorker().postMessage({
	        action: 'parse',
	        id: requestId,
        mode,
	        text,
	      });
	    },
	    [beginFormatWorkerRequest, clearParseTimer, getFormatWorker, scheduleFormatWorkerTimeout],
	  );

  const scheduleEditorParse = useCallback(
    (mode: ViewMode, text: string) => {
      clearParseTimer();
      activeSearchId.current += 1;
      setLastOutputBytes(null);
      if (mode === 'json') {
        setSearchState({ kind: 'message', message: '等待 JSON 解析' });
        parseTimer.current = window.setTimeout(() => {
          parseJsonText(text);
        }, EDITOR_PARSE_DEBOUNCE_MS);
      } else {
        const label = mode.toUpperCase();
        setSearchState({ kind: 'message', message: `等待 ${label} 解析` });
        setSurfaceNote(`${label} 编辑中`);
        parseTimer.current = window.setTimeout(() => {
          parseAlternateFormat(mode, text);
        }, EDITOR_PARSE_DEBOUNCE_MS);
      }
    },
    [clearParseTimer, parseAlternateFormat, parseJsonText],
  );

  const setViewMode = useCallback(
    (mode: ViewMode) => {
      if (activeTabId === null) {
        updateStatus('请先打开文件', 'warn');
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
          updateStatus(parseError ? `当前内容无法转换为 JSON：${parseError}` : '当前内容还没有可用的 RTON Value', 'error');
          setSurfaceNote('JSON 预览不可用');
          return;
        }

	        renderTextForValue(value, mode);
	      } else {
	        renderAlternateFormat(mode);
	      }
	    },
			    [activeTabId, editorSurface, invalidateFormatWork, parseError, renderAlternateFormat, renderTextForValue, updateStatus],
			  );

	  const hasActiveFile = activeTabId !== null && tabs.length > 0;
	  const displayFileName = hasActiveFile ? fileName : EMPTY_FILE_NAME;
	  const targetBinaryEncoding = useMemo<RtonBinaryEncoding>(
	    () => ({ compact: compactOutput, encrypted: encryptOutput }),
	    [compactOutput, encryptOutput],
	  );
	  const hexVariantNeeded =
	    hasActiveFile &&
	    editorSurface === 'hex' &&
	    binaryBytes !== null &&
	    binaryEncoding !== null &&
	    !sameRtonEncoding(binaryEncoding, targetBinaryEncoding);
	  const displayedHexBytes =
	    hexVariantNeeded && byteTransformState.bytes && sameNullableRtonEncoding(byteTransformState.target, targetBinaryEncoding)
	      ? byteTransformState.bytes
	      : binaryBytes;
	  const canGenerateHexVariant = hexVariantNeeded && wasmReady && currentValue !== null;
	  const outputText = hasActiveFile
	    ? editorSurface === 'hex' && binaryBytes
	      ? `${formatBytes((displayedHexBytes ?? binaryBytes).byteLength)} · ${
	          hexVariantNeeded ? formatRtonEncoding(targetBinaryEncoding) : 'raw bytes'
	        }`
	      : lastOutputBytes
	      ? `${formatBytes(lastOutputBytes)} · ${compactOutput ? 'compact' : 'standard'}${encryptOutput ? ' · encrypted' : ''}`
	      : '未生成'
	    : '无';
	  const displaySurfaceNote =
	    editorSurface === 'hex'
	      ? binaryBytes
	        ? hexVariantNeeded
	          ? `RTON · ${formatRtonEncoding(targetBinaryEncoding)}`
	          : `RTON · ${formatBytes(binaryBytes.byteLength)}`
	        : 'RTON 不可用'
	      : surfaceNote;

	  const validateValue = useCallback(() => {
    if (activeTabId === null) {
      updateStatus('请先打开文件', 'warn');
      return;
    }

    if (!wasmReady) {
      updateStatus('wasm 仍在初始化', 'warn');
      return;
    }

    try {
	      if (editorSurface === 'hex' && binaryBytes) {
	        const outputBytes = hexVariantNeeded
	          ? byteTransformState.bytes ?? encodeCurrentRtonBytes(currentValueRef.current, compactOutput, encryptOutput, parseError)
	          : binaryBytes;
	        setLastOutputBytes(outputBytes.byteLength);
	        updateStatus(`${formatRtonEncoding(targetBinaryEncoding)} RTON 可导出`, 'ok');
	        return;
	      }

      const value = currentValueRef.current;
      if (!value) {
        throw new Error(parseError ?? '当前内容还没有可用的 RTON Value');
      }
      const bytes = encodeRtonOutputBytes(value, compactOutput, encryptOutput);
      setLastOutputBytes(bytes.byteLength);
      updateStatus(`${viewModeRef.current.toUpperCase()} 可导出`, 'ok');
    } catch (error) {
      updateStatus(errorMessage(error), 'error');
    }
	  }, [
	    activeTabId,
	    binaryBytes,
	    byteTransformState.bytes,
	    compactOutput,
	    editorSurface,
	    encryptOutput,
	    hexVariantNeeded,
	    parseError,
	    targetBinaryEncoding,
	    updateStatus,
	    wasmReady,
	  ]);

  const refreshOutputBytesForOptions = useCallback(
    (compact: boolean, encrypted: boolean) => {
      if (lastOutputBytes === null || activeTabId === null || !wasmReady) {
        return;
      }

      const value = currentValueRef.current;
      if (!value) {
        return;
      }

      try {
        setLastOutputBytes(encodeRtonOutputBytes(value, compact, encrypted).byteLength);
      } catch (error) {
        setLastOutputBytes(null);
        updateStatus(errorMessage(error), 'error');
      }
    },
    [activeTabId, lastOutputBytes, updateStatus, wasmReady],
  );

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
        updateStatus('wasm 就绪，等待文件', 'ok');
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
  }, [updateStatus]);

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
      setSearchState({ kind: 'message', message: EMPTY_SEARCH_MESSAGE });
      return;
    }

    const query = searchQuery.trim().toLowerCase();
    if (parseError) {
      setSearchState({ kind: 'message', message: parseError });
      return;
    }

    if (!currentValue) {
      setSearchState({ kind: 'message', message: '没有可搜索的 RtonValue' });
      return;
    }

    if (!query) {
      setSearchState({ kind: 'idle' });
      return;
    }

    setSearchState({ kind: 'message', message: `搜索 "${query}"...` });
    const searchId = activeSearchId.current + 1;
    activeSearchId.current = searchId;
    searchTimer.current = window.setTimeout(() => {
      runChunkedSearch(currentValue, query, searchId, activeSearchId, setSearchState);
    }, SEARCH_DEBOUNCE_MS);
  }, [activeTabId, currentValue, parseError, searchQuery]);

	  const loadedFileItems = useMemo(
    () => buildLoadedFileItems({ files: loadedFiles, tabs, activeTabId, fileName, sourceBytes, viewMode, editorSurface }),
    [activeTabId, editorSurface, fileName, loadedFiles, sourceBytes, tabs, viewMode],
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
    ? `匹配 ${visibleFileCount.toLocaleString()} / ${listedFileCount.toLocaleString()} 个文件 · 已选 ${selectedFileCount.toLocaleString()}`
    : `已选 ${selectedFileCount.toLocaleString()} / ${listedFileCount.toLocaleString()} 个文件`;
  const workspaceStyle = {
    '--rton-left-panel-width': `${leftPanelWidth}px`,
    '--rton-right-panel-width': `${rightPanelWidth}px`,
  } as CSSProperties;

  useEffect(() => {
    if (!canGenerateHexVariant || !currentValue) {
      terminateByteTransformWorker();
      resetByteTransformState();
      return;
    }

    terminateByteTransformWorker();
    const requestId = byteTransformRequestId.current + 1;
    byteTransformRequestId.current = requestId;
    const target = targetBinaryEncoding;
    setByteTransformState({
      status: 'running',
      target,
      bytes: null,
      elapsedMs: null,
      error: null,
    });
    updateStatus(`正在后台生成 ${formatRtonEncoding(target)} Hex`, 'warn');

    getByteTransformWorker().postMessage(
      {
        id: requestId,
        target,
        value: currentValue,
      },
    );
  }, [
    canGenerateHexVariant,
    currentValue,
    getByteTransformWorker,
    resetByteTransformState,
    targetBinaryEncoding,
    terminateByteTransformWorker,
    updateStatus,
  ]);

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
      updateStatus('请先打开文件', 'warn');
      return;
    }

    if (binaryBytes) {
      setEditorSurface('hex');
      setSurfaceNote('RTON 可编辑');
      return;
    }

    const value = currentValueRef.current;
    if (!value) {
      updateStatus(parseError ?? '当前内容还没有可用的 RTON Value', 'error');
      return;
    }

    try {
	      const bytes = encodeRtonOutputBytes(value, compactOutput, encryptOutput);
	      setBinaryBytes(bytes);
	      setBinaryEncoding({ compact: compactOutput, encrypted: encryptOutput });
	      setSourceBytes(bytes);
      setLastOutputBytes(null);
      setEditorSurface('hex');
      setSurfaceNote('RTON 可编辑');
      updateStatus('已从当前 RtonValue 生成二进制 RTON，可直接编辑字节', 'ok');
    } catch (error) {
      updateStatus(errorMessage(error), 'error');
    }
  }, [activeTabId, binaryBytes, compactOutput, encryptOutput, parseError, updateStatus]);

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
        setSurfaceNote('RTON 可编辑');
        updateStatus(`RTON 已更新，${encrypted ? '加密 ' : ''}RTON 解析成功`, 'ok');
      } catch (error) {
        const message = errorMessage(error);
        invalidateFormatWork();
        setCurrentValueState(null);
        setParsedJson(null);
        setParseError(message);
        setStats(emptyStats());
        setSearchState({ kind: 'message', message });
        setSurfaceNote('RTON 无法解析');
        updateStatus(`RTON 已更新，但 RTON 解析失败：${message}`, 'error');
      }
    },
    [activeTabId, clearPendingWork, invalidateFormatWork, renderTextForValue, setCurrentValueState, updateStatus],
  );

	  const onDisplayedHexBytesChange = useCallback(
	    (nextBytes: Uint8Array) => {
	      if (!hexVariantNeeded) {
	        onHexBytesChange(nextBytes);
	        return;
	      }
	
	      updateStatus('当前 Hex 是按 Compact/加密选项生成的只读预览，请切回原始形态后编辑 bytes', 'warn');
	    },
	    [hexVariantNeeded, onHexBytesChange, updateStatus],
	  );

  const loadSample = () => {
    if (!wasmReady) {
      updateStatus('wasm 仍在初始化', 'warn');
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
        status: { message: '样例已载入', tone: 'ok' },
      });
      nextTabId.current += 1;
      openEditorTabs([tab]);
    } catch (error) {
      updateStatus(errorMessage(error), 'error');
    }
  };

  const loadRtonEntries = async (entries: RtonLoadEntry[]) => {
    if (!wasmReady) {
      updateStatus('wasm 仍在初始化', 'warn');
      return;
    }

    const candidates = collectLoadableCandidates(entries, true);
    const skipped = entries.length - candidates.length;
    if (candidates.length === 0) {
      updateStatus(`未找到 ${LOADABLE_FILE_HINT} 文件`, 'warn');
      return;
    }

    const loadedTabs: EditorTab[] = [];
    const errors: string[] = [];
    const preferredEditorSurface: EditorSurface = activeTabId === null ? 'hex' : editorSurface;
    for (const entry of candidates) {
      try {
        const decoded = await decodeLoadableSource(entry, viewModeRef.current, preferredEditorSurface);
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
	      const suffix = skipped > 0 ? `，跳过 ${skipped} 个不支持的文件` : '';
	      const message = loadedTabs.length === 1 ? `${loadedTabs[0].status.message}${suffix}` : `已载入 ${loadedTabs.length} 个文件${suffix}`;
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
        updateStatus(`未找到 ${LOADABLE_FILE_HINT} 文件`, 'warn');
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
      const suffix = skipped > 0 ? `，跳过 ${skipped} 个不支持的文件` : '';
      updateStatus(`已索引 ${nextFiles.length} 个文件${suffix}，点击左侧文件加载`, 'ok');
    },
    [updateStatus],
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
        updateStatus('wasm 仍在初始化', 'warn');
        return;
      }

      try {
        updateStatus(`正在解析 ${entry.path}`, 'warn');
        const preferredEditorSurface: EditorSurface = activeTabId === null ? 'hex' : editorSurface;
        const decoded = await decodeLoadableSource(entry, viewModeRef.current, preferredEditorSurface);
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
	    [activateEditorTab, activeTabId, editorSurface, loadedFiles, openEditorTabs, renderTextForValue, tabs, updateStatus, wasmReady],
	  );

  const loadRtonFiles = async (files: File[]) => {
    await loadRtonEntries(files.map((file) => ({ file, path: displayFilePath(file) })));
  };

  const loadRtonFolder = async () => {
    const picker = (window as DirectoryPickerWindow).showDirectoryPicker;
    if (!picker) {
      updateStatus('Safari 不支持点击选择文件夹，请把文件夹拖到页面中加载', 'warn');
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
        updateStatus('浏览器拒绝打开目录选择器，请把文件夹拖到页面中加载', 'warn');
        return;
      }
      updateStatus(errorMessage(error), 'error');
    }
  };

  const downloadRton = () => {
    if (activeTabId === null) {
      updateStatus('请先打开文件', 'warn');
      return;
    }

    if (!wasmReady) {
      updateStatus('wasm 仍在初始化', 'warn');
      return;
    }

	    try {
	      if (editorSurface === 'hex' && binaryBytes) {
	        const outputBytes = hexVariantNeeded
	          ? byteTransformState.bytes ?? encodeCurrentRtonBytes(currentValueRef.current, compactOutput, encryptOutput, parseError)
	          : binaryBytes;
	        setLastOutputBytes(outputBytes.byteLength);
	        downloadBytes(outputBytes, outputBaseName(fileName, 'rton'));
	        updateStatus(`${formatRtonEncoding(targetBinaryEncoding)} RTON 已生成`, 'ok');
	        return;
	      }

      const value = currentValueRef.current;
      if (!value) {
        throw new Error(parseError ?? '当前内容还没有可用的 RTON Value');
      }
      const outputBytes = encodeRtonOutputBytes(value, compactOutput, encryptOutput);
      setLastOutputBytes(outputBytes.byteLength);
      downloadBytes(outputBytes, outputBaseName(fileName, 'rton'));
      updateStatus(`${compactOutput ? 'Compact' : 'Standard'} RTON${encryptOutput ? ' 已加密' : ''} 已生成`, 'ok');
    } catch (error) {
      updateStatus(errorMessage(error), 'error');
    }
	  };

  const downloadJson = () => {
    if (activeTabId === null) {
      updateStatus('请先打开文件', 'warn');
      return;
    }

    try {
      const value = currentValueRef.current;
      if (!value) {
        throw new Error(parseError ?? '当前内容还没有可用的 RTON Value');
      }
      downloadBlob(new Blob([rtonValueToJsonText(value, true)], { type: 'application/json' }), outputBaseName(fileName, 'json'));
      updateStatus('JSON 已生成', 'ok');
    } catch (error) {
      updateStatus(errorMessage(error), 'error');
    }
  };

  const downloadStructuredFormat = async (mode: StructuredFormatMode) => {
    if (activeTabId === null) {
      updateStatus('请先打开文件', 'warn');
      return;
    }

    try {
      const value = currentValueRef.current;
      if (!value) {
        throw new Error(parseError ?? '当前内容还没有可用的 RTON Value');
      }
      const { formatStructuredText } = await import('./format-conversion');
      const text = formatStructuredText(value, mode);
      downloadBlob(text, outputBaseName(fileName, mode), mode === 'yaml' ? 'application/yaml' : 'application/toml');
      updateStatus(`${mode.toUpperCase()} 已生成`, 'ok');
    } catch (error) {
      updateStatus(errorMessage(error), 'error');
    }
  };

  const batchExportSelectedFiles = useCallback(
    async (mode: BatchExportMode) => {
      if (!wasmReady) {
        updateStatus('wasm 仍在初始化', 'warn');
        return;
      }

      const selectedItems = loadedFileItems.filter((item) => selectedFileKeys.has(item.key));
      if (selectedItems.length === 0) {
        updateStatus('请先在左侧文件列表选择文件', 'warn');
        return;
      }

      updateStatus(`正在批量转换 ${selectedItems.length.toLocaleString()} 个文件为 ${mode.toUpperCase()}`, 'warn');

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
        updateStatus(errors[0] ?? '没有文件转换成功', 'error');
        return;
      }

      const zipBytes = createZipArchive(zipEntries);
      downloadBytes(zipBytes, `rton-editor-${mode}-${timestampForFileName()}.zip`);
      const errorSuffix = errors.length > 0 ? `，${errors.length} 个失败` : '';
      updateStatus(`已批量导出 ${zipEntries.length.toLocaleString()} 个 ${mode.toUpperCase()}${errorSuffix}`, errors.length > 0 ? 'warn' : 'ok');
    },
    [
      activeTabId,
      compactOutput,
      encryptOutput,
      loadedFileItems,
      loadedFiles,
      selectedFileKeys,
      tabs,
      updateStatus,
      wasmReady,
    ],
  );

  const updateRtonValueNode = useCallback(
    (path: RtonValuePath, nextValue: RtonValue) => {
      if (activeTabId === null) {
        updateStatus('请先打开文件', 'warn');
        return;
      }

      const current = currentValueRef.current;
      if (!current) {
        updateStatus(parseError ?? '当前内容还没有可用的 RTON Value', 'error');
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
        updateStatus(rendered ? 'RtonValue 已更新' : 'RtonValue 已更新，JSON 预览不可用', rendered ? 'ok' : 'warn');
      } catch (error) {
        updateStatus(errorMessage(error), 'error');
      }
    },
    [activeTabId, parseError, renderTextForValue, setCurrentValueState, updateStatus],
  );

  const navigateToRtonValueNode = useCallback(
    (path: RtonValuePath) => {
      const value = currentValueRef.current;
      if (!value) {
        updateStatus(parseError ?? '当前内容还没有可用的 RTON Value', 'warn');
        return;
      }

	      if (editorSurface === 'hex') {
	        const navigableBytes = displayedHexBytes ?? binaryBytes;
	        if (!navigableBytes) {
	          updateStatus('当前没有可跳转的 RTON 字节', 'warn');
          return;
        }
        if (isEncryptedRtonBytes(navigableBytes)) {
          updateStatus('当前显示的是加密 RTON 密文字节，无法按解密后的结构跳转 offset', 'warn');
          return;
        }

        const offset = locateRtonValueOffset(navigableBytes, path);
        if (offset === null) {
          updateStatus('未找到对应 RTON offset', 'warn');
          return;
        }

        setHexJumpTarget({
          id: nextHexJumpId.current,
          offset,
        });
        nextHexJumpId.current += 1;
        updateStatus(`已跳转到 offset 0x${offset.toString(16).toUpperCase()}`, 'ok');
        return;
      }

      const position = locateRtonPathInText(value, path, editorText, viewModeRef.current);
      if (!position) {
        updateStatus('未找到对应文本行', 'warn');
        return;
      }

      setEditorJumpTarget({
        id: nextEditorJumpId.current,
        line: position.line,
        column: position.column,
      });
      nextEditorJumpId.current += 1;
      updateStatus(`已跳转到第 ${position.line.toLocaleString()} 行`, 'ok');
    },
	    [binaryBytes, displayedHexBytes, editorSurface, editorText, parseError, updateStatus],
	  );

  const toolbarGroups = {
    file: {
      label: '文件',
      content: (
        <>
          <button type="button" onClick={() => fileInputRef.current?.click()} className={buttonClass('primary')}>
            <FileUp />
            打开文件
          </button>
          <button type="button" onClick={() => void loadRtonFolder()} className={buttonClass('secondary')}>
            <FolderOpen />
            打开文件夹
          </button>
          <button type="button" onClick={loadSample} className={buttonClass('secondary')}>
            样例
          </button>
          <span className="min-w-24 max-w-80 flex-1 truncate px-1 font-semibold text-[var(--color-text-strong)]">{displayFileName}</span>
        </>
      ),
    },
    format: {
      label: '文本格式',
      role: 'tablist',
      ariaLabel: '文本格式',
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
      label: '文本导出',
      ariaLabel: '文本导出',
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
      label: 'RTON 导出',
      ariaLabel: 'RTON 导出',
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
                refreshOutputBytesForOptions(nextCompact, encryptOutput);
              }}
            />
            <span className="rton-switch-label">Compact</span>
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
                refreshOutputBytesForOptions(compactOutput, nextEncrypt);
              }}
            />
            <span className="rton-switch-label">加密</span>
            <span className="rton-switch-track" aria-hidden="true" />
          </label>
	          <button type="button" onClick={validateValue} disabled={!hasActiveFile || !wasmReady} className={buttonClass('secondary')}>
            <CheckCircle2 />
            验证
          </button>
          <button type="button" onClick={downloadRton} disabled={!hasActiveFile || !wasmReady} className={buttonClass('primary')}>
            <Download />
            RTON
          </button>
        </>
      ),
    },
    prefs: {
      label: '偏好',
      ariaLabel: '偏好',
      content: (
        <>
          <label className="rton-theme-label">
            <span>主题</span>
            <RtonInlineSelect
              value={themePreference}
              options={THEME_OPTIONS}
              ariaLabel="选择主题"
              variant="toolbar"
              className="rton-theme-select"
              onChange={setThemePreference}
            />
          </label>
          <label className="rton-switch">
            <input
              type="checkbox"
              checked={lineWrapping}
              className="rton-switch-input"
              aria-label="自动换行"
              onChange={(event) => setLineWrapping(event.currentTarget.checked)}
            />
            <span className="rton-switch-label">自动换行</span>
            <span className="rton-switch-track" aria-hidden="true" />
          </label>
          <label className="rton-switch">
            <input
              type="checkbox"
              checked={hasActiveFile && editorSearchPanelVisible}
              disabled={!hasActiveFile}
              className="rton-switch-input"
              aria-label="搜索栏"
              onChange={(event) => setEditorSearchPanelVisible(event.currentTarget.checked)}
            />
            <span className="rton-switch-label">搜索栏</span>
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
            title="文件列表"
            subtitle={fileListSubtitle}
            actions={
              <>
                <button type="button" onClick={selectAllListedFiles} disabled={visibleFileCount === 0} className={buttonClass('secondary')}>
                  <CheckCheck />
                  全选
                </button>
                <button type="button" onClick={clearSelectedFiles} disabled={selectedVisibleFileCount === 0} className={buttonClass('secondary')}>
                  <Square />
                  全不选
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
                placeholder="搜索文件"
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
                  aria-label="清除文件搜索"
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
              emptyMessage={fileSearchActive ? '没有匹配的文件' : '未打开文件'}
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
	              readOnly={hexVariantNeeded}
	              searchPanelVisible={editorSearchPanelVisible}
              onChange={onDisplayedHexBytesChange}
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
                拖放文件或文件夹到此处加载
              </div>
              <div className="text-[13px] text-[var(--color-drop-hint-sub)]">支持 {LOADABLE_FILE_HINT}，文件夹会保留相对路径</div>
            </div>
          )}
        </section>

        <PanelResizeHandle side="right" width={rightPanelWidth} onResize={resizePanel} />

        <aside className="rton-side-panel rton-side-panel-right">
          <div className="shrink-0 border-b border-[var(--color-border)]">
            <PanelHeader icon={<FileArchive />} title="文件属性" subtitle="当前文件" />
            <section className="border-b border-[var(--color-border)] p-3">
              <dl className="grid gap-3 text-sm">
                <MetaItem label="名称" value={displayFileName} />
                <MetaItem label="输入" value={hasActiveFile ? (sourceBytes ? formatBytes(sourceBytes.byteLength) : '文本') : '无'} />
                <MetaItem label="输出" value={outputText} />
	                {hexVariantNeeded && (
	                  <MetaItem
	                    label="Hex"
	                    value={
	                      byteTransformState.bytes
	                        ? `${formatRtonEncoding(byteTransformState.target ?? targetBinaryEncoding)} · ${formatBytes(byteTransformState.bytes.byteLength)}${
	                            byteTransformState.elapsedMs === null ? '' : ` · ${formatDuration(byteTransformState.elapsedMs)}`
	                          }`
	                        : byteTransformState.error
	                        ? `不可用：${byteTransformState.error}`
	                        : byteTransformState.status === 'running' && byteTransformState.target
	                        ? `${formatRtonEncoding(byteTransformState.target)} 生成中`
	                        : canGenerateHexVariant
	                        ? '未生成'
	                        : '仅 RTON Hex 视图可用'
	                    }
                  />
                )}
              </dl>
            </section>

            <section className="p-3">
              <div className="mb-3 flex items-center gap-2">
                <Activity className="h-4 w-4 text-[var(--color-text-muted)]" />
                <h2 className="text-xs font-semibold uppercase text-[var(--color-text-muted)]">统计</h2>
              </div>
              <div className="grid grid-cols-2 gap-2">
                <Stat label="节点" value={stats.nodes} />
                <Stat label="对象" value={stats.objects} />
                <Stat label="数组" value={stats.arrays} />
                <Stat label="深度" value={stats.maxDepth} />
              </div>
            </section>
          </div>

          <div className="flex min-h-0 flex-1 flex-col">
            <div className="flex min-h-10 shrink-0 items-center justify-between gap-2 border-b border-[var(--color-border)] bg-[var(--color-surface-raised)] px-2.5 py-2">
              <div className="min-w-0">
                <div className="flex items-center gap-2 text-[var(--color-text-strong)]">
                  <ListTree className="h-4 w-4 text-[var(--color-accent-text)]" />
                  <h2 className="text-sm font-semibold leading-none">索引</h2>
                </div>
                <p className="mt-1 text-xs text-[var(--color-text-muted)]">RtonValue</p>
              </div>
              <div className="relative min-w-0 max-w-44">
                <Search className="pointer-events-none absolute left-2 top-1.5 h-4 w-4 text-[var(--color-text-subtle)]" />
                <input
                  type="search"
                  value={searchQuery}
                  placeholder="搜索"
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
                    aria-label="清除索引搜索"
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
                <InspectorContent
                  state={searchState}
                  value={currentValue}
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
        <span className="hidden shrink-0 tabular-nums text-[var(--color-text-muted)] sm:inline">输出 {outputText}</span>
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

function PanelHeader({
  icon,
  title,
  subtitle,
  actions,
  below,
}: {
  icon: ReactNode;
  title: string;
  subtitle?: string;
  actions?: ReactNode;
  below?: ReactNode;
}) {
  return (
    <header className="min-h-10 shrink-0 border-b border-[var(--color-border)] bg-[var(--color-surface-raised)] px-2.5 py-2">
      <div className="flex min-w-0 items-start justify-between gap-2">
        <div className="min-w-0 flex-1">
          <div className="flex min-w-0 items-center gap-2 text-[var(--color-text-strong)]">
            <span className="shrink-0 [&>svg]:h-4 [&>svg]:w-4 [&>svg]:text-[var(--color-accent-text)]">{icon}</span>
            <h2 className="truncate text-sm font-semibold leading-none">{title}</h2>
          </div>
          {subtitle && <p className="mt-1 truncate text-xs text-[var(--color-text-muted)]">{subtitle}</p>}
        </div>
        {actions && <div className="flex shrink-0 items-center justify-end gap-1.5 whitespace-nowrap">{actions}</div>}
      </div>
      {below && <div className="mt-2">{below}</div>}
    </header>
  );
}

function MetaItem({ label, value }: { label: string; value: string }) {
  return (
    <div className="min-w-0">
      <dt className="text-xs text-[var(--color-text-muted)]">{label}</dt>
      <dd className="mt-1 break-words text-[var(--color-text-strong)]">{value}</dd>
    </div>
  );
}

function Stat({ label, value }: { label: string; value: number }) {
  return (
    <div className="min-w-0 rounded border border-[var(--color-border)] bg-[var(--color-surface-soft)] p-2.5">
      <span className="block text-xs text-[var(--color-text-muted)]">{label}</span>
      <strong className="mt-1 block text-xl leading-none text-[var(--color-text-strong)]">{value.toLocaleString()}</strong>
    </div>
  );
}

function PanelResizeHandle({
  side,
  width,
  onResize,
}: {
  side: PanelSide;
  width: number;
  onResize: (side: PanelSide, width: number) => void;
}) {
  const [dragging, setDragging] = useState(false);
  const draggingRef = useRef(false);
  const startRef = useRef({ x: 0, width });

  useEffect(() => {
    if (!dragging) {
      return;
    }

    const handleMouseMove = (event: MouseEvent) => {
      if (!draggingRef.current) {
        return;
      }
      const delta = side === 'left' ? event.clientX - startRef.current.x : startRef.current.x - event.clientX;
      onResize(side, startRef.current.width + delta);
    };
    const handleMouseUp = () => {
      draggingRef.current = false;
      setDragging(false);
    };

    window.addEventListener('mousemove', handleMouseMove);
    window.addEventListener('mouseup', handleMouseUp);
    return () => {
      window.removeEventListener('mousemove', handleMouseMove);
      window.removeEventListener('mouseup', handleMouseUp);
    };
  }, [dragging, onResize, side]);

  const finishDrag = (event: ReactPointerEvent<HTMLDivElement>) => {
    if (!draggingRef.current) {
      return;
    }
    draggingRef.current = false;
    setDragging(false);
    if (event.currentTarget.hasPointerCapture(event.pointerId)) {
      event.currentTarget.releasePointerCapture(event.pointerId);
    }
  };

  return (
    <div
      className={cx('rton-resize-handle', `rton-resize-handle-${side}`, dragging && 'dragging')}
      role="separator"
      aria-orientation="vertical"
      aria-label={side === 'left' ? '调整文件列表宽度' : '调整文件属性宽度'}
      onPointerDown={(event) => {
        event.preventDefault();
        startRef.current = { x: event.clientX, width };
        draggingRef.current = true;
        setDragging(true);
        event.currentTarget.setPointerCapture(event.pointerId);
      }}
      onPointerMove={(event) => {
        if (!draggingRef.current) {
          return;
        }
        const delta = side === 'left' ? event.clientX - startRef.current.x : startRef.current.x - event.clientX;
        onResize(side, startRef.current.width + delta);
      }}
      onPointerUp={finishDrag}
      onPointerCancel={finishDrag}
      onMouseDown={(event) => {
        if (draggingRef.current) {
          return;
        }
        event.preventDefault();
        startRef.current = { x: event.clientX, width };
        draggingRef.current = true;
        setDragging(true);
      }}
    />
  );
}

function DraggableToolbar({ groups }: { groups: Record<ToolbarGroupId, ToolbarGroupConfig> }) {
  const dragGroupIdRef = useRef<ToolbarGroupId | null>(null);
  const dragHandleIdRef = useRef<ToolbarGroupId | null>(null);
  const [rows, setRows] = useState<ToolbarRows>(() => readToolbarRows());
  const [draggedGroupId, setDraggedGroupId] = useState<ToolbarGroupId | null>(null);
  const [dropMarker, setDropMarker] = useState<DropMarker<ToolbarGroupId> | null>(null);

  useEffect(() => {
    try {
      localStorage.setItem(TOOLBAR_LAYOUT_KEY, JSON.stringify(rows));
    } catch (error) {
      console.warn('Failed to save toolbar layout:', error);
    }
  }, [rows]);

  const finishDrag = () => {
    dragGroupIdRef.current = null;
    dragHandleIdRef.current = null;
    setDraggedGroupId(null);
    setDropMarker(null);
  };

  const updateDropMarker = (marker: DropMarker<ToolbarGroupId> | null) => {
    setDropMarker((current) => (isSameDropMarker(current, marker) ? current : marker));
  };

  useEffect(() => {
    const clearHandleArm = () => {
      if (!dragGroupIdRef.current) {
        dragHandleIdRef.current = null;
      }
    };

    window.addEventListener('mouseup', clearHandleArm, true);
    window.addEventListener('blur', finishDrag);
    return () => {
      window.removeEventListener('mouseup', clearHandleArm, true);
      window.removeEventListener('blur', finishDrag);
    };
  }, []);

  const armDragHandle = (event: ReactMouseEvent<HTMLButtonElement>, id: ToolbarGroupId) => {
    if (event.button !== 0) {
      return;
    }
    dragHandleIdRef.current = id;
  };

  const startGroupDrag = (event: ReactDragEvent<HTMLDivElement>, id: ToolbarGroupId) => {
    if (dragHandleIdRef.current !== id) {
      event.preventDefault();
      return;
    }

    dragGroupIdRef.current = id;
    setDraggedGroupId(id);
    setDropMarker(null);
    event.dataTransfer.effectAllowed = 'move';
    event.dataTransfer.setData('text/plain', id);
  };

  const applyDropTarget = (event: ReactDragEvent<HTMLElement>, target: ToolbarDropTarget) => {
    const draggedId = dragGroupIdRef.current;
    if (!draggedId) {
      return;
    }

    event.preventDefault();
    event.stopPropagation();
    event.dataTransfer.dropEffect = 'move';

    if (target.type === 'group') {
      if (target.id === draggedId) {
        return;
      }
      updateDropMarker({ id: target.id, placement: target.placement });
      setRows((currentRows) => moveToolbarGroup(currentRows, draggedId, target.id, target.placement));
      return;
    }

    updateDropMarker(null);
    setRows((currentRows) => moveToolbarGroupToRowEnd(currentRows, draggedId, target.rowIndex));
  };

  const moveDraggedGroup = (event: ReactDragEvent<HTMLElement>, targetId: ToolbarGroupId) => {
    const draggedId = dragGroupIdRef.current;
    if (!draggedId || draggedId === targetId) {
      return;
    }

    const rect = event.currentTarget.getBoundingClientRect();
    const placement: DropPlacement = event.clientX < rect.left + rect.width / 2 ? 'before' : 'after';
    applyDropTarget(event, { type: 'group', id: targetId, placement });
  };

  const moveDraggedGroupInRow = (event: ReactDragEvent<HTMLDivElement>, rowIndex: number) => {
    const draggedId = dragGroupIdRef.current;
    if (!draggedId) {
      return;
    }

    const target = findToolbarRowDropTarget(event.currentTarget, event.clientX, event.clientY, draggedId) ?? {
      type: 'row-end' as const,
      rowIndex,
    };
    applyDropTarget(event, target);
  };

  return (
    <>
      {rows.map((row, rowIndex) => (
        <div
          key={rowIndex}
          className="rton-toolbar-row"
          data-toolbar-row-index={rowIndex}
          onDragOver={(event) => moveDraggedGroupInRow(event, rowIndex)}
          onDrop={(event) => {
            event.preventDefault();
            finishDrag();
          }}
        >
          {row.map((id) => {
            const group = groups[id];
            return (
              <div
                key={id}
                className={cx(
                  'rton-toolbar-group-shell',
                  draggedGroupId === id && 'dragging',
                  dropMarker?.id === id && `drop-${dropMarker.placement}`,
                )}
                data-toolbar-group-id={id}
                draggable
                onDragStart={(event) => startGroupDrag(event, id)}
                onDragOver={(event) => moveDraggedGroup(event, id)}
                onDrop={(event) => {
                  event.preventDefault();
                  event.stopPropagation();
                  finishDrag();
                }}
                onDragEnd={finishDrag}
              >
                <button
                  type="button"
                  className="rton-toolbar-group-drag-handle"
                  title={`拖动移动工具栏分组：${group.label}`}
                  aria-label={`拖动移动工具栏分组：${group.label}`}
                  onMouseDown={(event) => armDragHandle(event, id)}
                >
                  <GripVertical aria-hidden="true" />
                </button>
                <div className="rton-toolbar-group" role={group.role} aria-label={group.ariaLabel}>
                  {group.content}
                </div>
              </div>
            );
          })}
        </div>
      ))}
    </>
  );
}

function EditorTabStrip({
  tabs,
  activeTabId,
  fileName,
  onActivate,
  onClose,
  onMove,
}: {
  tabs: EditorTab[];
  activeTabId: number | null;
  fileName: string;
  onActivate: (tabId: number) => void;
  onClose: (tabId: number) => void;
  onMove: (tabId: number, targetTabId: number, placement: DropPlacement) => void;
}) {
  const dragTabIdRef = useRef<number | null>(null);
  const dragArmedTabIdRef = useRef<number | null>(null);
  const tabsRef = useRef(tabs);
  const [draggedTabId, setDraggedTabId] = useState<number | null>(null);
  const [dropMarker, setDropMarker] = useState<DropMarker<number> | null>(null);
  tabsRef.current = tabs;

  const finishDrag = () => {
    dragTabIdRef.current = null;
    dragArmedTabIdRef.current = null;
    setDraggedTabId(null);
    setDropMarker(null);
  };

  const updateDropMarker = (marker: DropMarker<number> | null) => {
    setDropMarker((current) => (isSameDropMarker(current, marker) ? current : marker));
  };

  useEffect(() => {
    const clearDragArm = () => {
      if (!dragTabIdRef.current) {
        dragArmedTabIdRef.current = null;
      }
    };

    window.addEventListener('mouseup', clearDragArm, true);
    window.addEventListener('blur', finishDrag);
    return () => {
      window.removeEventListener('mouseup', clearDragArm, true);
      window.removeEventListener('blur', finishDrag);
    };
  }, []);

  const armTabDrag = (event: ReactMouseEvent<HTMLDivElement>, tabId: number) => {
    if (tabs.length < 2 || event.button !== 0) {
      return;
    }
    if ((event.target as Element).closest('.rton-file-tab-close')) {
      return;
    }
    dragArmedTabIdRef.current = tabId;
  };

  const startTabDrag = (event: ReactDragEvent<HTMLDivElement>, tabId: number) => {
    if (dragArmedTabIdRef.current !== tabId) {
      event.preventDefault();
      return;
    }

    dragTabIdRef.current = tabId;
    setDraggedTabId(tabId);
    setDropMarker(null);
    event.dataTransfer.effectAllowed = 'move';
    event.dataTransfer.setData('text/plain', String(tabId));
  };

  const applyTabDropTarget = (event: ReactDragEvent<HTMLDivElement>, target: DropMarker<number> | null) => {
    const draggedId = dragTabIdRef.current;
    if (draggedId === null || !target || draggedId === target.id) {
      return;
    }

    event.preventDefault();
    event.stopPropagation();
    event.dataTransfer.dropEffect = 'move';

    updateDropMarker(target);
    if (isCurrentPlacement(tabsRef.current, draggedId, target.id, target.placement)) {
      return;
    }

    tabsRef.current = reorderTabs(tabsRef.current, draggedId, target.id, target.placement);
    onMove(draggedId, target.id, target.placement);
  };

  const moveDraggedTab = (event: ReactDragEvent<HTMLDivElement>, targetId: number) => {
    const draggedId = dragTabIdRef.current;
    if (draggedId === null || draggedId === targetId) {
      return;
    }

    const rect = event.currentTarget.getBoundingClientRect();
    const placement: DropPlacement = event.clientX < rect.left + rect.width / 2 ? 'before' : 'after';
    applyTabDropTarget(event, { id: targetId, placement });
  };

  const moveDraggedTabInContainer = (event: ReactDragEvent<HTMLDivElement>) => {
    const draggedId = dragTabIdRef.current;
    if (draggedId === null) {
      return;
    }
    applyTabDropTarget(event, findTabDropTarget(event.currentTarget, event.clientX, draggedId));
  };

  return (
    <nav className="rton-tab-strip">
      <div role="tablist" aria-label="已打开文件" className="rton-file-tabs" onDragOver={moveDraggedTabInContainer}>
        {tabs.map((tab) => {
          const active = tab.id === activeTabId;
          const fullName = active ? fileName : tab.fileName;
          const displayName = leafDisplayName(fullName);
          return (
            <div
              key={tab.id}
              className={cx(
                fileTabClass(active),
                draggedTabId === tab.id && 'dragging',
                dropMarker?.id === tab.id && `drop-${dropMarker.placement}`,
              )}
              data-tab-id={tab.id}
              draggable={tabs.length > 1}
              onMouseDown={(event) => armTabDrag(event, tab.id)}
              onDragStart={(event) => startTabDrag(event, tab.id)}
              onDragOver={(event) => moveDraggedTab(event, tab.id)}
              onDrop={(event) => {
                event.preventDefault();
                finishDrag();
              }}
              onDragEnd={finishDrag}
            >
              <button
                type="button"
                role="tab"
                aria-selected={active}
                title={`切换到 ${fullName}`}
                className="min-w-0 flex-1 border-0 bg-transparent px-2.5 text-left text-inherit focus-visible:outline-none"
                onClick={() => onActivate(tab.id)}
              >
                <span className="block overflow-hidden text-ellipsis whitespace-nowrap">{displayName}</span>
              </button>
              <button
                type="button"
                title="关闭此文件"
                aria-label="关闭此文件"
                className="rton-file-tab-close mr-1 grid h-5 w-5 shrink-0 place-items-center rounded border-0 bg-transparent text-[var(--color-text-muted)] hover:bg-[var(--color-border)] hover:text-[var(--color-text-strong)] focus-visible:outline-none"
                onClick={(event) => {
                  event.stopPropagation();
                  onClose(tab.id);
                }}
              >
                ×
              </button>
            </div>
          );
        })}
      </div>
    </nav>
  );
}

function LoadedFilesTree({
  items,
  selectedKeys,
  emptyMessage,
  forceOpenFolders,
  onOpenFile,
  onActivate,
  onClose,
  onToggleSelected,
  onToggleSelectedMany,
}: {
  items: LoadedFileTreeItem[];
  selectedKeys: Set<string>;
  emptyMessage: string;
  forceOpenFolders: boolean;
  onOpenFile: (fileId: number) => void;
  onActivate: (tabId: number) => void;
  onClose: (tabId: number) => void;
  onToggleSelected: (key: string, selected: boolean) => void;
  onToggleSelectedMany: (keys: string[], selected: boolean) => void;
}) {
  const nodes = useMemo(() => buildLoadedFileTree(items), [items]);

  return (
    <div role="tree" aria-label="已加载文件" className="grid gap-1">
      {nodes.length === 0 ? (
        <div className="rounded border border-[var(--color-border)] bg-[var(--color-surface-soft)] p-3 text-xs text-[var(--color-text-muted)]">
          {emptyMessage}
        </div>
      ) : (
        nodes.map((node) => (
          <LoadedFileTreeNodeView
            key={node.kind === 'folder' ? `folder:${node.path}` : node.item.key}
            node={node}
            canClose={Boolean(node.kind === 'file' && node.item.tabId)}
            onOpenFile={onOpenFile}
            onActivate={onActivate}
            onClose={onClose}
            forceOpenFolders={forceOpenFolders}
            selectedKeys={selectedKeys}
            onToggleSelected={onToggleSelected}
            onToggleSelectedMany={onToggleSelectedMany}
          />
        ))
      )}
    </div>
  );
}

function LoadedFileTreeNodeView({
  node,
  canClose,
  onOpenFile,
  onActivate,
  onClose,
  forceOpenFolders,
  selectedKeys,
  onToggleSelected,
  onToggleSelectedMany,
}: {
  node: LoadedFileTreeNode;
  canClose: boolean;
  onOpenFile: (fileId: number) => void;
  onActivate: (tabId: number) => void;
  onClose: (tabId: number) => void;
  forceOpenFolders: boolean;
  selectedKeys: Set<string>;
  onToggleSelected: (key: string, selected: boolean) => void;
  onToggleSelectedMany: (keys: string[], selected: boolean) => void;
}) {
  if (node.kind === 'folder') {
    return (
      <LoadedFolderTreeNodeView
        node={node}
        onOpenFile={onOpenFile}
        onActivate={onActivate}
        onClose={onClose}
        forceOpenFolders={forceOpenFolders}
        selectedKeys={selectedKeys}
        onToggleSelected={onToggleSelected}
        onToggleSelectedMany={onToggleSelectedMany}
      />
    );
  }

  const { item } = node;
  const closeTabId = item.tabId;
  return (
    <div role="treeitem" aria-selected={item.active} className={fileListItemClass(item.active)}>
      <label className="grid h-full w-8 shrink-0 place-items-center text-[var(--color-text-muted)]">
        <input
          type="checkbox"
          checked={selectedKeys.has(item.key)}
          aria-label={`选择 ${item.path}`}
          className="h-4 w-4 accent-[var(--color-accent)]"
          onChange={(event) => onToggleSelected(item.key, event.currentTarget.checked)}
          onClick={(event) => event.stopPropagation()}
        />
      </label>
      <button
        type="button"
        title={item.path}
        className="min-w-0 flex-1 border-0 bg-transparent px-2.5 py-2 text-left text-inherit focus-visible:outline-none"
        onClick={() => {
          if (item.tabId !== null) {
            onActivate(item.tabId);
          } else if (item.fileId !== null) {
            void onOpenFile(item.fileId);
          }
        }}
      >
        <span className="block overflow-hidden text-ellipsis whitespace-nowrap font-mono text-[12px] text-[var(--color-text-strong)]">
          {item.name}
        </span>
        <span className="mt-1 block overflow-hidden text-ellipsis whitespace-nowrap text-xs text-[var(--color-text-muted)]">
          {item.detail}
        </span>
      </button>
      {canClose && closeTabId !== null && (
        <button
          type="button"
          title="关闭此文件"
          aria-label="关闭此文件"
          className="mr-1 grid h-6 w-6 shrink-0 place-items-center rounded border-0 bg-transparent text-[var(--color-text-muted)] hover:bg-[var(--color-border)] hover:text-[var(--color-text-strong)] focus-visible:outline-none"
          onClick={(event) => {
            event.stopPropagation();
            onClose(closeTabId);
          }}
        >
          ×
        </button>
      )}
    </div>
  );
}

function LoadedFolderTreeNodeView({
  node,
  onOpenFile,
  onActivate,
  onClose,
  forceOpenFolders,
  selectedKeys,
  onToggleSelected,
  onToggleSelectedMany,
}: {
  node: LoadedFileTreeNode & { kind: 'folder' };
  onOpenFile: (fileId: number) => void;
  onActivate: (tabId: number) => void;
  onClose: (tabId: number) => void;
  forceOpenFolders: boolean;
  selectedKeys: Set<string>;
  onToggleSelected: (key: string, selected: boolean) => void;
  onToggleSelectedMany: (keys: string[], selected: boolean) => void;
}) {
  const [open, setOpen] = useState(false);
  const checkboxRef = useRef<HTMLInputElement | null>(null);
  const fileKeys = useMemo(() => collectLoadedFileKeys(node), [node]);
  const selectedCount = fileKeys.reduce((count, key) => count + (selectedKeys.has(key) ? 1 : 0), 0);
  const checked = fileKeys.length > 0 && selectedCount === fileKeys.length;
  const indeterminate = selectedCount > 0 && selectedCount < fileKeys.length;
  const detailsOpen = forceOpenFolders || open;

  useEffect(() => {
    if (checkboxRef.current) {
      checkboxRef.current.indeterminate = indeterminate;
    }
  }, [indeterminate]);

  return (
    <details open={detailsOpen} onToggle={(event) => {
      if (!forceOpenFolders) {
        setOpen(event.currentTarget.open);
      }
    }} className="min-w-0">
      <summary
        role="treeitem"
        aria-label={node.path}
        className="rton-file-tree-summary cursor-pointer rounded px-2 py-1.5 text-xs font-semibold text-[var(--color-text-muted)] hover:bg-[var(--color-control-hover)]"
      >
        <span className="rton-file-tree-summary-content">
          <label className="grid h-4 w-4 shrink-0 place-items-center text-[var(--color-text-muted)]" onClick={(event) => event.stopPropagation()}>
            <input
              ref={checkboxRef}
              type="checkbox"
              checked={checked}
              aria-label={`选择 ${node.path}`}
              className="h-4 w-4 accent-[var(--color-accent)]"
              onChange={(event) => onToggleSelectedMany(fileKeys, event.currentTarget.checked)}
              onClick={(event) => event.stopPropagation()}
            />
          </label>
          <span className="min-w-0 overflow-hidden text-ellipsis whitespace-nowrap font-mono">{node.name}</span>
          <span className="min-w-0 overflow-hidden text-ellipsis whitespace-nowrap font-normal tabular-nums text-[var(--color-text-subtle)]">{node.count} 个文件</span>
        </span>
      </summary>
      {detailsOpen && (
        <div role="group" className="ml-3 grid gap-1 border-l border-[var(--color-border)] pl-2">
          {node.children.map((child) => (
            <LoadedFileTreeNodeView
              key={child.kind === 'folder' ? `folder:${child.path}` : child.item.key}
              node={child}
              canClose={Boolean(child.kind === 'file' && child.item.tabId)}
              onOpenFile={onOpenFile}
              onActivate={onActivate}
              onClose={onClose}
              forceOpenFolders={forceOpenFolders}
              selectedKeys={selectedKeys}
              onToggleSelected={onToggleSelected}
              onToggleSelectedMany={onToggleSelectedMany}
            />
          ))}
        </div>
      )}
    </details>
  );
}

function InspectorContent({
  state,
  value,
  onChange,
  onNavigate,
  onError,
}: {
  state: SearchState;
  value: RtonValue | null;
  onChange: (path: RtonValuePath, value: RtonValue) => void;
  onNavigate: (path: RtonValuePath) => void;
  onError: (message: string) => void;
}) {
  if (state.kind === 'message') {
    return <div className="rounded border border-[var(--color-border-strong)] bg-[var(--color-surface-soft)] p-3 text-[var(--color-warning)]">{state.message}</div>;
  }

  if (state.kind === 'results') {
    if (state.matches.length === 0) {
      return <div className="rounded border border-[var(--color-border-strong)] bg-[var(--color-surface-soft)] p-3 text-[var(--color-warning)]">{state.done ? '没有匹配' : `搜索中... 已扫描 ${state.scanned.toLocaleString()} 个节点`}</div>;
    }

    const summary = state.capped
      ? `显示前 ${SEARCH_MATCH_LIMIT} 条匹配，请继续输入以缩小范围`
      : state.done
        ? `${state.matches.length} 条匹配，扫描 ${state.scanned.toLocaleString()} 个节点`
        : `${state.matches.length} 条匹配，仍在搜索...`;

    return (
      <div className="grid gap-1">
        <div className="sticky top-0 z-10 mb-1 rounded border border-[var(--color-border)] bg-[var(--color-surface)] p-2 text-[var(--color-text-muted)]">
          {summary} · {state.query}
        </div>
        {state.matches.map((match) => (
          <div key={`${match.path}:${match.preview}`} className="rton-search-result-row" onClick={() => onNavigate(match.valuePath)}>
            <button
              type="button"
              className="rton-search-result-path"
              onClick={(event) => {
                event.stopPropagation();
                onNavigate(match.valuePath);
              }}
            >
              {match.path}
            </button>
            <span className="rton-search-result-preview">{match.preview}</span>
          </div>
        ))}
      </div>
    );
  }

  if (!value) {
    return <div className="rounded border border-[var(--color-border-strong)] bg-[var(--color-surface-soft)] p-3 text-[var(--color-warning)]">没有可浏览的 RtonValue</div>;
  }

  return <RtonValueTreeNode label="$" value={value} path={[]} depth={0} onChange={onChange} onNavigate={onNavigate} onError={onError} />;
}

function RtonValueTreeNode({
  label,
  value,
  path,
  depth,
  onChange,
  onNavigate,
  onError,
}: {
  label: string;
  value: RtonValue;
  path: RtonValuePath;
  depth: number;
  onChange: (path: RtonValuePath, value: RtonValue) => void;
  onNavigate: (path: RtonValuePath) => void;
  onError: (message: string) => void;
}) {
  const [open, setOpen] = useState(depth === 0);
  const navigate = (event: ReactMouseEvent<HTMLElement> | ReactKeyboardEvent<HTMLElement>) => {
    event.preventDefault();
    event.stopPropagation();
    onNavigate(path);
  };
  const navigateOnKeyDown = (event: ReactKeyboardEvent<HTMLElement>) => {
    if (event.key === 'Enter' || event.key === ' ') {
      navigate(event);
    }
  };
  const navigateFromRow = (event: ReactMouseEvent<HTMLElement>) => {
    if ((event.target as HTMLElement).closest('.rton-inline-select-control, input, button')) {
      return;
    }
    onNavigate(path);
  };

  if (value.kind === 'array') {
    return (
      <details open={open} onToggle={(event) => setOpen(event.currentTarget.open)} className="my-0.5">
        <summary className="cursor-pointer rounded px-1 py-1 hover:bg-[var(--color-control-hover)]" onClick={navigateFromRow}>
          <span
            role="button"
            tabIndex={0}
            className="cursor-pointer text-[var(--color-accent-text)] hover:underline focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-[var(--color-focus)]"
            onClick={navigate}
            onKeyDown={navigateOnKeyDown}
          >
            {label}
          </span>
          <span className="ml-2 text-[var(--color-text-muted)]">array · {value.items.length}</span>
          <RtonValueKindSelect value={value} path={path} onChange={onChange} onError={onError} className="ml-2" />
        </summary>
        {open && (
          <RtonValueTreeChildren
            entries={value.items.map((item, index) => ({
              key: `[${index}]`,
              value: item,
              path: [...path, { kind: 'array' as const, index }],
            }))}
            depth={depth + 1}
            onChange={onChange}
            onNavigate={onNavigate}
            onError={onError}
          />
        )}
      </details>
    );
  }

  if (value.kind === 'object') {
    return (
      <details open={open} onToggle={(event) => setOpen(event.currentTarget.open)} className="my-0.5">
        <summary className="cursor-pointer rounded px-1 py-1 hover:bg-[var(--color-control-hover)]" onClick={navigateFromRow}>
          <span
            role="button"
            tabIndex={0}
            className="cursor-pointer text-[var(--color-accent-text)] hover:underline focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-[var(--color-focus)]"
            onClick={navigate}
            onKeyDown={navigateOnKeyDown}
          >
            {label}
          </span>
          <span className="ml-2 text-[var(--color-text-muted)]">object · {value.entries.length}</span>
          <RtonValueKindSelect value={value} path={path} onChange={onChange} onError={onError} className="ml-2" />
        </summary>
        {open && (
          <RtonValueTreeChildren
            entries={value.entries.map((entry, index) => ({
              key: entry.key,
              value: entry.value,
              path: [...path, { kind: 'object' as const, index }],
            }))}
            depth={depth + 1}
            onChange={onChange}
            onNavigate={onNavigate}
            onError={onError}
          />
        )}
      </details>
    );
  }

  return (
    <div className="rton-value-scalar-row" onClick={() => onNavigate(path)}>
      <button
        type="button"
        className="rton-value-node-link"
        onClick={(event) => {
          event.stopPropagation();
          onNavigate(path);
        }}
      >
        {label}
      </button>
      <div className="rton-value-kind-cell">
        <RtonValueKindSelect value={value} path={path} onChange={onChange} onError={onError} />
      </div>
      <div className="rton-value-editor-cell">
        <RtonScalarEditor value={value} path={path} onChange={onChange} onError={onError} />
      </div>
    </div>
  );
}

function RtonValueTreeChildren({
  entries,
  depth,
  onChange,
  onNavigate,
  onError,
}: {
  entries: ReadonlyArray<{ key: string; value: RtonValue; path: RtonValuePath }>;
  depth: number;
  onChange: (path: RtonValuePath, value: RtonValue) => void;
  onNavigate: (path: RtonValuePath) => void;
  onError: (message: string) => void;
}) {
  const shown = entries.slice(0, TREE_CHILD_LIMIT);

  return (
    <div className="rton-value-tree-children" style={{ '--rton-value-depth': depth } as CSSProperties}>
      {shown.map((entry, index) => (
        <RtonValueTreeNode
          key={`${entry.key}:${index}`}
          label={entry.key}
          value={entry.value}
          path={entry.path}
          depth={depth}
          onChange={onChange}
          onNavigate={onNavigate}
          onError={onError}
        />
      ))}
      {entries.length > shown.length && (
        <div className="my-1 rounded border border-[var(--color-border)] bg-[var(--color-surface-soft)] p-2 text-[var(--color-text-muted)]">
          仅显示前 {shown.length} 项，共 {entries.length} 项。请用搜索定位更深内容。
        </div>
      )}
    </div>
  );
}

const RTON_VALUE_KINDS: RtonValue['kind'][] = [
  'null',
  'bool',
  'i8',
  'u8',
  'i16',
  'u16',
  'i32',
  'u32',
  'i64',
  'u64',
  'var-i32',
  'var-u32',
  'var-i64',
  'var-u64',
  'f32',
  'f64',
  'string',
  'binary',
  'rtid',
  'array',
  'object',
];
const RTON_VALUE_KIND_OPTIONS = RTON_VALUE_KINDS.map((kind) => ({ value: kind, label: kind }));

function RtonInlineSelect<T extends string>({
  value,
  options,
  onChange,
  ariaLabel,
  variant = 'compact',
  className,
}: {
  value: T;
  options: ReadonlyArray<RtonInlineSelectOption<T>>;
  onChange: (value: T) => void;
  ariaLabel: string;
  variant?: 'compact' | 'toolbar';
  className?: string;
}) {
  const controlRef = useRef<HTMLSpanElement | null>(null);
  const menuRef = useRef<HTMLDivElement | null>(null);
  const generatedId = useId();
  const [open, setOpen] = useState(false);
  const selected = options.find((option) => option.value === value);
  const menuId = `${generatedId}-menu`;

  const positionMenu = useCallback(() => {
    const control = controlRef.current;
    const menu = menuRef.current;
    if (!control || !menu) {
      return;
    }

    const viewportPadding = 8;
    const menuGap = 6;
    const controlRect = control.getBoundingClientRect();
    const menuMinWidth = Math.max(variant === 'toolbar' ? 138 : 112, Math.round(controlRect.width));
    menu.style.setProperty('--rton-select-menu-min-width', `${menuMinWidth}px`);
    menu.style.setProperty('--rton-select-menu-max-height', `${Math.max(96, window.innerHeight - viewportPadding * 2)}px`);
    menu.style.removeProperty('--rton-select-menu-width');

    const optionWidth = Math.max(
      menuMinWidth,
      ...Array.from(menu.querySelectorAll('button')).map((button) => button.scrollWidth + (variant === 'toolbar' ? 10 : 12)),
    );
    const menuWidth = Math.min(Math.ceil(optionWidth), window.innerWidth - viewportPadding * 2);
    menu.style.setProperty('--rton-select-menu-width', `${menuWidth}px`);

    const menuHeight = menu.getBoundingClientRect().height || 0;
    const maxLeft = window.innerWidth - viewportPadding - menuWidth;
    const left = Math.max(viewportPadding, Math.min(controlRect.left, maxLeft));
    const belowTop = controlRect.bottom + menuGap;
    const aboveTop = controlRect.top - menuGap - menuHeight;
    const hasMoreSpaceAbove = controlRect.top - viewportPadding > window.innerHeight - controlRect.bottom - viewportPadding;
    const top =
      belowTop + menuHeight <= window.innerHeight - viewportPadding || !hasMoreSpaceAbove
        ? Math.min(belowTop, window.innerHeight - viewportPadding - menuHeight)
        : aboveTop;

    menu.style.setProperty('--rton-select-menu-left', `${Math.round(left)}px`);
    menu.style.setProperty('--rton-select-menu-top', `${Math.round(Math.max(viewportPadding, top))}px`);
  }, [variant]);

  useLayoutEffect(() => {
    if (open) {
      positionMenu();
    }
  }, [open, options, positionMenu, value]);

  useEffect(() => {
    if (!open) {
      return;
    }

    const closeOnOutsidePointer = (event: PointerEvent) => {
      const target = event.target as Node;
      if (controlRef.current?.contains(target) || menuRef.current?.contains(target)) {
        return;
      }
      setOpen(false);
    };
    const reposition = () => positionMenu();

    document.addEventListener('pointerdown', closeOnOutsidePointer);
    window.addEventListener('resize', reposition);
    window.addEventListener('scroll', reposition, true);
    return () => {
      document.removeEventListener('pointerdown', closeOnOutsidePointer);
      window.removeEventListener('resize', reposition);
      window.removeEventListener('scroll', reposition, true);
    };
  }, [open, positionMenu]);

  const selectOption = useCallback(
    (nextValue: T) => {
      setOpen(false);
      onChange(nextValue);
      requestAnimationFrame(() => controlRef.current?.focus());
    },
    [onChange],
  );

  const handleKeyDown = (event: ReactKeyboardEvent<HTMLSpanElement>) => {
    if (event.key === 'Enter' || event.key === ' ' || event.key === 'ArrowDown') {
      event.preventDefault();
      setOpen(true);
    } else if (event.key === 'Escape') {
      setOpen(false);
    }
  };

  return (
    <>
      <span
        ref={controlRef}
        className={cx('rton-inline-select-control', variant === 'toolbar' && 'rton-inline-select-toolbar', open && 'is-open', className)}
        role="button"
        aria-label={ariaLabel}
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-controls={open ? menuId : undefined}
        tabIndex={0}
        onClick={(event) => {
          event.preventDefault();
          event.stopPropagation();
          setOpen((current) => !current);
        }}
        onMouseDown={(event) => event.stopPropagation()}
        onKeyDown={handleKeyDown}
      >
        <span className="rton-inline-select-value" title={selected?.label}>
          {selected?.label ?? value}
        </span>
        <span className="rton-inline-select-caret">▾</span>
      </span>
      {open &&
        createPortal(
          <div
            ref={menuRef}
            id={menuId}
            className={cx('rton-inline-select-menu', variant === 'toolbar' && 'rton-inline-select-menu-toolbar')}
            role="listbox"
            aria-label={ariaLabel}
            onPointerDown={(event) => event.stopPropagation()}
          >
            {options.map((option) => (
              <button
                key={option.value}
                type="button"
                className={cx(option.value === value && 'active')}
                role="option"
                aria-selected={option.value === value}
                title={option.label}
                onClick={(event) => {
                  event.stopPropagation();
                  selectOption(option.value);
                }}
              >
                {option.label}
              </button>
            ))}
          </div>,
          document.body,
        )}
    </>
  );
}

function RtonValueKindSelect({
  value,
  path,
  onChange,
  onError,
  className,
}: {
  value: RtonValue;
  path: RtonValuePath;
  onChange: (path: RtonValuePath, value: RtonValue) => void;
  onError: (message: string) => void;
  className?: string;
}) {
  return (
    <RtonInlineSelect
      value={value.kind}
      options={RTON_VALUE_KIND_OPTIONS}
      ariaLabel="选择 RtonValue 类型"
      className={cx('rton-inline-select-kind', className)}
      onChange={(nextKind) => {
        try {
          onChange(path, convertRtonValueKind(value, nextKind));
        } catch (error) {
          onError(errorMessage(error));
        }
      }}
    />
  );
}

function RtonScalarEditor({
  value,
  path,
  onChange,
  onError,
}: {
  value: RtonValue;
  path: RtonValuePath;
  onChange: (path: RtonValuePath, value: RtonValue) => void;
  onError: (message: string) => void;
}) {
  const [text, setText] = useState(() => rtonScalarEditText(value));

  useEffect(() => {
    setText(rtonScalarEditText(value));
  }, [value]);

  if (value.kind === 'null') {
    return <span className="text-[var(--color-text-muted)]">null</span>;
  }

  if (value.kind === 'bool') {
    return (
      <RtonInlineSelect
        value={String(value.value)}
        options={[
          { value: 'true', label: 'true' },
          { value: 'false', label: 'false' },
        ]}
        ariaLabel="选择布尔值"
        className="rton-inline-select-bool"
        onChange={(nextValue) => onChange(path, { kind: 'bool', value: nextValue === 'true' })}
      />
    );
  }

  const commit = () => {
    try {
      const nextValue = updateRtonScalarText(value, text);
      onChange(path, nextValue);
    } catch (error) {
      onError(errorMessage(error));
      setText(rtonScalarEditText(value));
    }
  };

  return (
    <input
      value={text}
      title={rtonScalarPreview(value)}
      className={cx(
        'h-6 w-full min-w-0 rounded border border-transparent bg-transparent px-1 text-[11px] text-[var(--color-text-strong)] hover:border-[var(--color-border)] hover:bg-[var(--color-control)] focus:border-[var(--color-accent-border)] focus:bg-[var(--color-control)] focus-visible:outline-none',
        rtonValueClass(value),
      )}
      onChange={(event) => setText(event.currentTarget.value)}
      onMouseDown={(event) => event.stopPropagation()}
      onClick={(event) => event.stopPropagation()}
      onBlur={commit}
      onKeyDown={(event) => {
        if (event.key === 'Enter') {
          event.currentTarget.blur();
        } else if (event.key === 'Escape') {
          setText(rtonScalarEditText(value));
          event.currentTarget.blur();
        }
      }}
    />
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
      const preview = previewValue(frame.value);
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

function previewValue(value: RtonValue): string {
  if (value.kind === 'array') {
    return `array(${value.items.length})`;
  }
  if (value.kind === 'object') {
    return `object(${value.entries.length})`;
  }
  return `${value.kind}: ${rtonScalarPreview(value)}`;
}

function rtonValueClass(value: RtonValue): string {
  if (value.kind === 'rtid') {
    return 'text-[var(--color-accent-text)]';
  }
  if (value.kind === 'binary') {
    return 'text-[var(--color-rton-binary)]';
  }
  if (value.kind === 'string') {
    return 'text-[var(--color-rton-string)]';
  }
  if (isRtonNumberKind(value.kind)) {
    return 'text-[var(--color-rton-number)]';
  }
  if (value.kind === 'bool') {
    return 'text-[var(--color-rton-bool)]';
  }
  return 'text-[var(--color-text-subtle)]';
}

const RTON_INTEGER_RANGES: Record<RtonIntegerKind, readonly [bigint, bigint]> = {
  i8: [-128n, 127n],
  u8: [0n, 255n],
  i16: [-32768n, 32767n],
  u16: [0n, 65535n],
  i32: [-2147483648n, 2147483647n],
  u32: [0n, 4294967295n],
  i64: [-9223372036854775808n, 9223372036854775807n],
  u64: [0n, 18446744073709551615n],
  'var-i32': [-2147483648n, 2147483647n],
  'var-u32': [0n, 4294967295n],
  'var-i64': [-9223372036854775808n, 9223372036854775807n],
  'var-u64': [0n, 18446744073709551615n],
};

function isRtonIntegerKind(kind: RtonValue['kind']): kind is RtonIntegerKind {
  return kind in RTON_INTEGER_RANGES;
}

function isRtonNumberKind(kind: RtonValue['kind']) {
  return isRtonIntegerKind(kind) || kind === 'f32' || kind === 'f64';
}

function rtonScalarEditText(value: RtonValue) {
  switch (value.kind) {
    case 'null':
      return 'null';
    case 'bool':
      return String(value.value);
    case 'f32':
    case 'f64':
      return formatRtonFloat(value.value);
    case 'string':
    case 'binary':
    case 'rtid':
      return value.value;
    case 'array':
      return `array(${value.items.length})`;
    case 'object':
      return `object(${value.entries.length})`;
    default:
      return value.value;
  }
}

function rtonScalarPreview(value: RtonValue) {
  const text = rtonScalarEditText(value);
  return text.length > 96 ? `${text.slice(0, 93)}...` : text;
}

function updateRtonScalarText(value: RtonValue, text: string): RtonValue {
  if (isRtonIntegerKind(value.kind)) {
    return { kind: value.kind, value: parseRtonIntegerText(text, value.kind) };
  }

  switch (value.kind) {
    case 'f32':
    case 'f64':
      return { kind: value.kind, value: parseRtonFloatText(text) };
    case 'string':
    case 'binary':
    case 'rtid':
      return { kind: value.kind, value: text };
    default:
      return value;
  }
}

function convertRtonValueKind(value: RtonValue, nextKind: RtonValue['kind']): RtonValue {
  if (value.kind === nextKind) {
    return value;
  }

  if (nextKind === 'array') {
    return { kind: 'array', items: value.kind === 'array' ? value.items : [] };
  }
  if (nextKind === 'object') {
    return { kind: 'object', entries: value.kind === 'object' ? value.entries : [] };
  }
  if (nextKind === 'null') {
    return { kind: 'null' };
  }
  if (nextKind === 'bool') {
    return { kind: 'bool', value: value.kind === 'bool' ? value.value : false };
  }

  const text = rtonScalarEditText(value);
  const defaultValue = defaultRtonValue(nextKind);
  try {
    return updateRtonScalarText(defaultValue, text);
  } catch {
    return defaultValue;
  }
}

function defaultRtonValue(kind: Exclude<RtonValue['kind'], 'array' | 'object'>): RtonValue {
  if (isRtonIntegerKind(kind)) {
    return { kind, value: '0' };
  }

  switch (kind) {
    case 'null':
      return { kind: 'null' };
    case 'bool':
      return { kind: 'bool', value: false };
    case 'f32':
    case 'f64':
      return { kind, value: 0 };
    case 'binary':
      return { kind: 'binary', value: '$BINARY("", 0)' };
    case 'rtid':
      return { kind: 'rtid', value: 'RTID(0)' };
    case 'string':
      return { kind: 'string', value: '' };
  }
}

function parseRtonIntegerText(text: string, kind: RtonIntegerKind) {
  const trimmed = text.trim();
  if (!/^[+-]?\d+$/.test(trimmed)) {
    throw new Error(`${kind} 需要整数`);
  }

  const value = BigInt(trimmed);
  const [min, max] = RTON_INTEGER_RANGES[kind];
  if (value < min || value > max) {
    throw new Error(`${kind} 超出范围：${min.toString()}..${max.toString()}`);
  }
  return value.toString();
}

function parseRtonFloatText(text: string) {
  const normalized = text.trim().toLowerCase();
  if (['inf', '+inf', 'infinity', '+infinity', '.inf', '+.inf'].includes(normalized)) {
    return Infinity;
  }
  if (['-inf', '-infinity', '-.inf'].includes(normalized)) {
    return -Infinity;
  }
  if (['nan', '+nan', '-nan', '.nan', '+.nan', '-.nan'].includes(normalized)) {
    return NaN;
  }

  const value = Number(text);
  if (Number.isNaN(value)) {
    throw new Error('浮点值需要 number / inf / -inf / nan');
  }
  return value;
}

function formatRtonFloat(value: number) {
  if (Number.isNaN(value)) {
    return 'nan';
  }
  if (value === Infinity) {
    return 'inf';
  }
  if (value === -Infinity) {
    return '-inf';
  }
  return String(value);
}

function replaceRtonValueAtPath(root: RtonValue, path: RtonValuePath, nextValue: RtonValue): RtonValue {
  if (path.length === 0) {
    return nextValue;
  }

  const [head, ...tail] = path;
  if (head.kind === 'array') {
    if (root.kind !== 'array' || head.index < 0 || head.index >= root.items.length) {
      throw new Error('RtonValue 路径已失效');
    }
    const items = [...root.items];
    items[head.index] = replaceRtonValueAtPath(items[head.index], tail, nextValue);
    return { kind: 'array', items };
  }

  if (root.kind !== 'object' || head.index < 0 || head.index >= root.entries.length) {
    throw new Error('RtonValue 路径已失效');
  }
  const entries = [...root.entries];
  const entry = entries[head.index];
  entries[head.index] = { ...entry, value: replaceRtonValueAtPath(entry.value, tail, nextValue) };
  return { kind: 'object', entries };
}

type TextPosition = { line: number; column: number };
type TextLineInfo = { index: number; offset: number; text: string };
type RtonPathTraceSegment =
  | { kind: 'object'; index: number; key: string; value: RtonValue }
  | { kind: 'array'; index: number; value: RtonValue };

function locateRtonPathInText(root: RtonValue, path: RtonValuePath, text: string, mode: ViewMode): TextPosition | null {
  if (!text) {
    return null;
  }

  const offset =
    mode === 'json'
      ? locateJsonRtonPathOffset(text, root, path)
      : mode === 'yaml'
        ? locateYamlRtonPathOffset(text, root, path)
        : locateTomlRtonPathOffset(text, root, path);
  const fallbackOffset = offset ?? fallbackLocateRtonPathOffset(text, root, path);
  return fallbackOffset === null ? null : offsetToTextPosition(text, fallbackOffset);
}

function locateJsonRtonPathOffset(text: string, root: RtonValue, path: RtonValuePath) {
  try {
    return locateJsonValueOffset(text, skipJsonWhitespace(text, 0), root, path);
  } catch {
    return null;
  }
}

function locateJsonValueOffset(text: string, position: number, value: RtonValue, path: RtonValuePath): number | null {
  const pos = skipJsonWhitespace(text, position);
  if (path.length === 0) {
    return pos;
  }

  const [segment, ...rest] = path;
  if (segment.kind === 'object') {
    if (value.kind !== 'object' || text[pos] !== '{') {
      return null;
    }

    let cursor = pos + 1;
    for (let index = 0; index < value.entries.length; index += 1) {
      cursor = skipJsonWhitespace(text, cursor);
      if (text[cursor] === '}') {
        return null;
      }

      const keyStart = cursor;
      const keyEnd = scanJsonStringEnd(text, keyStart);
      if (keyEnd === null) {
        return null;
      }

      cursor = skipJsonWhitespace(text, keyEnd);
      if (text[cursor] !== ':') {
        return null;
      }

      const childStart = skipJsonWhitespace(text, cursor + 1);
      const entry = value.entries[index];
      if (segment.index === index) {
        return rest.length === 0 ? keyStart : locateJsonValueOffset(text, childStart, entry.value, rest);
      }

      const nextCursor = skipJsonValue(text, childStart);
      if (nextCursor === null) {
        return null;
      }
      cursor = skipJsonWhitespace(text, nextCursor);
      if (text[cursor] === ',') {
        cursor += 1;
      }
    }
    return null;
  }

  if (value.kind !== 'array' || text[pos] !== '[') {
    return null;
  }

  let cursor = pos + 1;
  for (let index = 0; index < value.items.length; index += 1) {
    const childStart = skipJsonWhitespace(text, cursor);
    if (text[childStart] === ']') {
      return null;
    }

    const item = value.items[index];
    if (segment.index === index) {
      return rest.length === 0 ? childStart : locateJsonValueOffset(text, childStart, item, rest);
    }

    const nextCursor = skipJsonValue(text, childStart);
    if (nextCursor === null) {
      return null;
    }
    cursor = skipJsonWhitespace(text, nextCursor);
    if (text[cursor] === ',') {
      cursor += 1;
    }
  }

  return null;
}

function skipJsonWhitespace(text: string, position: number) {
  let cursor = position;
  while (cursor < text.length && /\s/.test(text[cursor])) {
    cursor += 1;
  }
  return cursor;
}

function scanJsonStringEnd(text: string, position: number): number | null {
  if (text[position] !== '"') {
    return null;
  }

  let cursor = position + 1;
  while (cursor < text.length) {
    const char = text[cursor];
    if (char === '\\') {
      cursor += 2;
    } else if (char === '"') {
      return cursor + 1;
    } else {
      cursor += 1;
    }
  }
  return null;
}

function skipJsonValue(text: string, position: number): number | null {
  const pos = skipJsonWhitespace(text, position);
  const first = text[pos];
  if (first === '"') {
    return scanJsonStringEnd(text, pos);
  }

  if (first === '{' || first === '[') {
    const close = first === '{' ? '}' : ']';
    let depth = 0;
    let cursor = pos;
    while (cursor < text.length) {
      const char = text[cursor];
      if (char === '"') {
        const end = scanJsonStringEnd(text, cursor);
        if (end === null) {
          return null;
        }
        cursor = end;
        continue;
      }
      if (char === first) {
        depth += 1;
      } else if (char === close) {
        depth -= 1;
        if (depth === 0) {
          return cursor + 1;
        }
      }
      cursor += 1;
    }
    return null;
  }

  let cursor = pos;
  while (cursor < text.length && !',]}'.includes(text[cursor])) {
    cursor += 1;
  }
  return cursor;
}

function locateYamlRtonPathOffset(text: string, root: RtonValue, path: RtonValuePath) {
  const trace = traceRtonPath(root, path);
  if (!trace) {
    return null;
  }
  if (trace.length === 0) {
    return 0;
  }

  const lines = textLines(text);
  let startLine = 0;
  let indent = 0;
  let lastOffset: number | null = null;

  for (const segment of trace) {
    if (segment.kind === 'object') {
      const found = findYamlKeyLine(lines, startLine, indent, segment.key);
      if (!found) {
        return null;
      }
      lastOffset = found.offset;
      startLine = found.line.index;
      indent = leadingSpaces(found.line.text) + (found.line.text.trimStart().startsWith('- ') ? 2 : 2);
    } else {
      const found = findYamlArrayItemLine(lines, startLine, indent, segment.index);
      if (!found) {
        return null;
      }
      lastOffset = found.offset;
      startLine = found.line.index;
      indent = leadingSpaces(found.line.text) + 2;
    }
  }

  return lastOffset;
}

function findYamlKeyLine(lines: TextLineInfo[], startLine: number, indent: number, key: string) {
  for (let index = startLine; index < lines.length; index += 1) {
    const line = lines[index];
    const trimmed = line.text.trim();
    if (!trimmed || trimmed.startsWith('#')) {
      continue;
    }

    const leading = leadingSpaces(line.text);
    if (index > startLine && indent > 0 && leading < indent && !line.text.trimStart().startsWith('- ')) {
      break;
    }

    const offset = yamlKeyOffset(line, key, indent);
    if (offset !== null) {
      return { line, offset };
    }
  }
  return null;
}

function findYamlArrayItemLine(lines: TextLineInfo[], startLine: number, indent: number, targetIndex: number) {
  let seen = 0;
  for (let index = startLine; index < lines.length; index += 1) {
    const line = lines[index];
    const trimmed = line.text.trim();
    if (!trimmed || trimmed.startsWith('#')) {
      continue;
    }

    const leading = leadingSpaces(line.text);
    if (index > startLine && indent > 0 && leading < indent) {
      break;
    }

    const content = line.text.slice(leading);
    if (leading === indent && content.startsWith('-')) {
      if (seen === targetIndex) {
        return { line, offset: line.offset + leading };
      }
      seen += 1;
    }
  }
  return null;
}

function yamlKeyOffset(line: TextLineInfo, key: string, indent: number) {
  const leading = leadingSpaces(line.text);
  const content = line.text.slice(leading);
  const keyOffset = yamlKeyPrefixOffset(content, key);
  if (leading === indent && keyOffset !== null) {
    return line.offset + leading + keyOffset;
  }

  if (leading === Math.max(0, indent - 2) && content.startsWith('- ')) {
    const inlineKeyOffset = yamlKeyPrefixOffset(content.slice(2), key);
    if (inlineKeyOffset !== null) {
      return line.offset + leading + 2 + inlineKeyOffset;
    }
  }

  return null;
}

function yamlKeyPrefixOffset(content: string, key: string) {
  for (const form of keyForms(key)) {
    if (content.startsWith(`${form}:`) || content.startsWith(`${form} :`)) {
      return 0;
    }
  }
  return null;
}

function locateTomlRtonPathOffset(text: string, root: RtonValue, path: RtonValuePath) {
  const trace = traceRtonPath(root, path);
  if (!trace) {
    return null;
  }
  if (trace.length === 0) {
    return 0;
  }

  const lines = textLines(text);
  const objectSegments = trace.filter((segment) => segment.kind === 'object');
  for (let index = objectSegments.length - 1; index >= 0; index -= 1) {
    const key = objectSegments[index].key;
    const assignment = findTomlAssignmentLine(lines, key);
    if (assignment) {
      return assignment;
    }
    const header = findTomlHeaderLine(lines, key);
    if (header) {
      return header;
    }
  }
  return null;
}

function findTomlAssignmentLine(lines: TextLineInfo[], key: string) {
  for (const line of lines) {
    const leading = leadingSpaces(line.text);
    const content = line.text.slice(leading);
    if (!content || content.startsWith('#') || content.startsWith('[')) {
      continue;
    }
    for (const form of keyForms(key)) {
      if (content.startsWith(form) && /^\s*=/.test(content.slice(form.length))) {
        return line.offset + leading;
      }
    }
  }
  return null;
}

function findTomlHeaderLine(lines: TextLineInfo[], key: string) {
  for (const line of lines) {
    const content = line.text.trim();
    if (!content.startsWith('[')) {
      continue;
    }
    const keyIndex = line.text.indexOf(key);
    if (keyIndex >= 0) {
      return line.offset + keyIndex;
    }
  }
  return null;
}

function fallbackLocateRtonPathOffset(text: string, root: RtonValue, path: RtonValuePath) {
  if (path.length === 0) {
    return 0;
  }

  const trace = traceRtonPath(root, path);
  let segment: RtonPathTraceSegment | null = null;
  for (let index = (trace?.length ?? 0) - 1; index >= 0; index -= 1) {
    const item = trace?.[index];
    if (item?.kind === 'object') {
      segment = item;
      break;
    }
  }
  if (!segment || segment.kind !== 'object') {
    return null;
  }

  const quotedIndex = text.indexOf(JSON.stringify(segment.key));
  if (quotedIndex >= 0) {
    return quotedIndex;
  }
  const plainIndex = text.indexOf(segment.key);
  return plainIndex >= 0 ? plainIndex : null;
}

function traceRtonPath(root: RtonValue, path: RtonValuePath): RtonPathTraceSegment[] | null {
  const trace: RtonPathTraceSegment[] = [];
  let value = root;

  for (const segment of path) {
    if (segment.kind === 'object') {
      if (value.kind !== 'object') {
        return null;
      }
      const entry = value.entries[segment.index];
      if (!entry) {
        return null;
      }
      trace.push({ kind: 'object', index: segment.index, key: entry.key, value: entry.value });
      value = entry.value;
    } else {
      if (value.kind !== 'array') {
        return null;
      }
      const item = value.items[segment.index];
      if (!item) {
        return null;
      }
      trace.push({ kind: 'array', index: segment.index, value: item });
      value = item;
    }
  }

  return trace;
}

function textLines(text: string): TextLineInfo[] {
  const rawLines = text.split('\n');
  let offset = 0;
  return rawLines.map((line, index) => {
    const cleanLine = line.endsWith('\r') ? line.slice(0, -1) : line;
    const info = { index, offset, text: cleanLine };
    offset += line.length + 1;
    return info;
  });
}

function leadingSpaces(text: string) {
  return text.length - text.trimStart().length;
}

function keyForms(key: string) {
  return [key, JSON.stringify(key), `'${key.replace(/'/g, "''")}'`];
}

function offsetToTextPosition(text: string, offset: number): TextPosition {
  const boundedOffset = Math.min(Math.max(0, offset), text.length);
  let line = 1;
  let lineStart = 0;
  for (let index = 0; index < boundedOffset; index += 1) {
    if (text[index] === '\n') {
      line += 1;
      lineStart = index + 1;
    }
  }
  return { line, column: boundedOffset - lineStart };
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

function leafDisplayName(path: string) {
  const parts = splitDisplayPath(path);
  return parts.at(-1) ?? path;
}

function cloneToolbarRows(rows: ToolbarRows): ToolbarRows {
  return rows.map((row) => [...row]);
}

function normalizeToolbarRows(value: unknown): ToolbarRows {
  const sourceRows = Array.isArray(value) ? value : DEFAULT_TOOLBAR_ROWS;
  const seen = new Set<ToolbarGroupId>();
  const rows: ToolbarRows = [[], []];

  sourceRows.forEach((row, rowIndex) => {
    if (!Array.isArray(row)) {
      return;
    }
    const targetRow = rows[Math.min(rowIndex, rows.length - 1)];
    row.forEach((id) => {
      if (typeof id !== 'string' || !isToolbarGroupId(id) || seen.has(id)) {
        return;
      }
      seen.add(id);
      targetRow.push(id);
    });
  });

  TOOLBAR_GROUP_IDS.forEach((id) => {
    if (!seen.has(id)) {
      rows[rows.length - 1].push(id);
    }
  });

  return rows;
}

function readToolbarRows(): ToolbarRows {
  try {
    return normalizeToolbarRows(JSON.parse(localStorage.getItem(TOOLBAR_LAYOUT_KEY) ?? 'null'));
  } catch {
    return cloneToolbarRows(DEFAULT_TOOLBAR_ROWS);
  }
}

function isToolbarGroupId(id: string): id is ToolbarGroupId {
  return (TOOLBAR_GROUP_IDS as string[]).includes(id);
}

function moveToolbarGroup(rows: ToolbarRows, groupId: ToolbarGroupId, targetId: ToolbarGroupId, placement: DropPlacement): ToolbarRows {
  if (groupId === targetId) {
    return rows;
  }

  const sourceRowIndex = rows.findIndex((row) => row.includes(groupId));
  const targetRowIndex = rows.findIndex((row) => row.includes(targetId));
  if (sourceRowIndex === -1 || targetRowIndex === -1) {
    return rows;
  }

  const sourceIndex = rows[sourceRowIndex].indexOf(groupId);
  const targetIndex = rows[targetRowIndex].indexOf(targetId);
  if (
    sourceRowIndex === targetRowIndex
    && ((placement === 'before' && sourceIndex === targetIndex - 1)
      || (placement === 'after' && sourceIndex === targetIndex + 1))
  ) {
    return rows;
  }

  const next = cloneToolbarRows(rows);
  const [group] = next[sourceRowIndex].splice(sourceIndex, 1);
  const nextTargetIndex = next[targetRowIndex].indexOf(targetId);
  if (nextTargetIndex === -1) {
    return rows;
  }
  next[targetRowIndex].splice(placement === 'after' ? nextTargetIndex + 1 : nextTargetIndex, 0, group);
  return next;
}

function moveToolbarGroupToRowEnd(rows: ToolbarRows, groupId: ToolbarGroupId, rowIndex: number): ToolbarRows {
  const sourceRowIndex = rows.findIndex((row) => row.includes(groupId));
  const targetRow = rows[rowIndex];
  if (sourceRowIndex === -1 || !targetRow) {
    return rows;
  }
  if (sourceRowIndex === rowIndex && targetRow[targetRow.length - 1] === groupId) {
    return rows;
  }

  const next = cloneToolbarRows(rows);
  const [group] = next[sourceRowIndex].splice(next[sourceRowIndex].indexOf(groupId), 1);
  next[rowIndex].push(group);
  return next;
}

function isSameDropMarker<T extends string | number>(a: DropMarker<T> | null, b: DropMarker<T> | null): boolean {
  if (a === b) {
    return true;
  }
  if (!a || !b) {
    return false;
  }
  return a.id === b.id && a.placement === b.placement;
}

function getDistanceToRectY(rect: DOMRect, clientY: number): number {
  if (clientY < rect.top) {
    return rect.top - clientY;
  }
  if (clientY > rect.bottom) {
    return clientY - rect.bottom;
  }
  return 0;
}

function findToolbarRowDropTarget(
  row: HTMLElement,
  clientX: number,
  clientY: number,
  draggedId: ToolbarGroupId,
): ToolbarDropTarget | null {
  const rowIndex = Number(row.dataset.toolbarRowIndex ?? NaN);
  if (!Number.isFinite(rowIndex)) {
    return null;
  }

  const groups = Array.from(row.querySelectorAll<HTMLElement>('.rton-toolbar-group-shell')).filter(
    (group) => group.dataset.toolbarGroupId !== draggedId,
  );
  if (groups.length === 0) {
    return { type: 'row-end', rowIndex };
  }

  const nearestLineDistance = Math.min(...groups.map((group) => getDistanceToRectY(group.getBoundingClientRect(), clientY)));
  const lineGroups = groups
    .filter((group) => getDistanceToRectY(group.getBoundingClientRect(), clientY) <= nearestLineDistance + 2)
    .sort((left, right) => left.getBoundingClientRect().left - right.getBoundingClientRect().left);

  for (const group of lineGroups) {
    const groupId = group.dataset.toolbarGroupId;
    if (!groupId || !isToolbarGroupId(groupId)) {
      continue;
    }

    const rect = group.getBoundingClientRect();
    if (clientX < rect.left + rect.width / 2) {
      return { type: 'group', id: groupId, placement: 'before' };
    }
  }

  const lastGroupId = lineGroups[lineGroups.length - 1]?.dataset.toolbarGroupId;
  if (!lastGroupId || !isToolbarGroupId(lastGroupId)) {
    return { type: 'row-end', rowIndex };
  }
  return { type: 'group', id: lastGroupId, placement: 'after' };
}

function isCurrentPlacement<T extends { id: number }>(
  items: readonly T[],
  draggedId: number,
  targetId: number,
  placement: DropPlacement,
): boolean {
  const draggedIndex = items.findIndex((item) => item.id === draggedId);
  const targetIndex = items.findIndex((item) => item.id === targetId);
  if (draggedIndex === -1 || targetIndex === -1) {
    return true;
  }

  return (
    (placement === 'before' && draggedIndex === targetIndex - 1)
    || (placement === 'after' && draggedIndex === targetIndex + 1)
  );
}

function reorderTabs<T extends { id: number }>(
  tabs: readonly T[],
  draggedId: number,
  targetId: number,
  placement: DropPlacement,
): T[] {
  const sourceIndex = tabs.findIndex((tab) => tab.id === draggedId);
  if (sourceIndex === -1) {
    return [...tabs];
  }

  const next = [...tabs];
  const [tab] = next.splice(sourceIndex, 1);
  const targetIndex = next.findIndex((candidate) => candidate.id === targetId);
  if (targetIndex === -1) {
    return [...tabs];
  }

  next.splice(placement === 'after' ? targetIndex + 1 : targetIndex, 0, tab);
  return next;
}

function findTabDropTarget(container: HTMLElement, clientX: number, draggedId: number): DropMarker<number> | null {
  const tabElements = Array.from(container.querySelectorAll<HTMLElement>('.rton-file-tab')).filter(
    (tab) => Number(tab.dataset.tabId ?? NaN) !== draggedId,
  );
  if (tabElements.length === 0) {
    return null;
  }

  for (const tab of tabElements) {
    const targetId = Number(tab.dataset.tabId ?? NaN);
    if (!Number.isFinite(targetId)) {
      continue;
    }

    const rect = tab.getBoundingClientRect();
    if (clientX < rect.left + rect.width / 2) {
      return { id: targetId, placement: 'before' };
    }
  }

  const lastTabId = Number(tabElements[tabElements.length - 1]?.dataset.tabId ?? NaN);
  if (!Number.isFinite(lastTabId)) {
    return null;
  }
  return { id: lastTabId, placement: 'after' };
}

function buildLoadedFileItems({
  files,
  tabs,
  activeTabId,
  fileName,
  sourceBytes,
  viewMode,
  editorSurface,
}: {
  files: LoadedRtonFile[];
  tabs: EditorTab[];
  activeTabId: number | null;
  fileName: string;
  sourceBytes: Uint8Array | null;
  viewMode: ViewMode;
  editorSurface: EditorSurface;
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
      detail: tab && mode ? `${bytes ? formatBytes(bytes.byteLength) : formatBytes(file.file.size)} · ${surface === 'hex' ? 'RTON' : mode.toUpperCase()}` : `${formatBytes(file.file.size)} · ${kindLabel} · 未打开`,
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
      detail: `${active ? (sourceBytes ? formatBytes(sourceBytes.byteLength) : '文本') : (tab.sourceBytes ? formatBytes(tab.sourceBytes.byteLength) : '文本')} · ${(active ? editorSurface : tab.editorSurface) === 'hex' ? 'RTON' : (active ? viewMode : tab.viewMode).toUpperCase()}`,
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

function buildLoadedFileTree(items: LoadedFileTreeItem[]): LoadedFileTreeNode[] {
  const root: LoadedFileTreeNode & { kind: 'folder' } = { kind: 'folder', name: '', path: '', count: 0, children: [] };
  const folders = new Map<string, LoadedFileTreeNode & { kind: 'folder' }>([['', root]]);

  for (const item of items) {
    const parts = splitDisplayPath(item.path);
    const fileName = parts.pop() ?? item.name;
    let parent = root;
    let parentPath = '';
    root.count += 1;

    for (const part of parts) {
      const folderPath = parentPath ? `${parentPath}/${part}` : part;
      let folder = folders.get(folderPath);
      if (!folder) {
        folder = { kind: 'folder', name: part, path: folderPath, count: 0, children: [] };
        folders.set(folderPath, folder);
        parent.children.push(folder);
      }
      folder.count += 1;
      parent = folder;
      parentPath = folderPath;
    }

    parent.children.push({ kind: 'file', name: fileName, item: { ...item, name: fileName } });
  }

  sortLoadedFileTree(root.children);
  return root.children;
}

function sortLoadedFileTree(nodes: LoadedFileTreeNode[]) {
  nodes.sort((left, right) => {
    if (left.kind !== right.kind) {
      return left.kind === 'folder' ? -1 : 1;
    }
    return left.name.localeCompare(right.name, undefined, { numeric: true, sensitivity: 'base' });
  });

  for (const node of nodes) {
    if (node.kind === 'folder') {
      sortLoadedFileTree(node.children);
    }
  }
}

function collectLoadedFileKeys(node: LoadedFileTreeNode): string[] {
  if (node.kind === 'file') {
    return [node.item.key];
  }

  return node.children.flatMap(collectLoadedFileKeys);
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

function sameNullableRtonEncoding(left: RtonBinaryEncoding | null, right: RtonBinaryEncoding) {
  return left !== null && sameRtonEncoding(left, right);
}

function formatRtonEncoding(encoding: RtonBinaryEncoding) {
  return `${encoding.compact ? 'Compact' : 'Standard'}${encoding.encrypted ? ' · 加密' : ''}`;
}

function encodeCurrentRtonBytes(value: RtonValue | null, compact: boolean, encrypted: boolean, parseError: string | null) {
  if (!value) {
    throw new Error(parseError ?? '当前内容还没有可用的 RTON Value');
  }
  return encodeRtonOutputBytes(value, compact, encrypted);
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

function jsonPreviewUnavailableText(message: string) {
  return `JSON 预览不可用\n\n${message}`;
}

function isPendingTextPreview(text: string) {
  return text.startsWith('正在后台生成 ') && text.endsWith(' 预览...');
}

function rtonValueToJsonValue(value: RtonValue) {
  return rtonValueToPlain(value) as JsonValue;
}

function decodeRtonSourceValue(bytes: Uint8Array, renderJsonPreview = true) {
  const encrypted = isEncryptedRtonBytes(bytes);
  const plainBytes = encrypted ? decrypt_rton_data(bytes) : bytes;
  const compact = isCompactRtonBytes(plainBytes);
  const wire = decode_rton_to_value(plainBytes);
  let editorText: string;
  let surfaceNote: string;
  if (renderJsonPreview) {
    try {
      editorText = value_to_json_text(wire, true);
      surfaceNote = 'JSON 可编辑';
    } catch (error) {
      editorText = jsonPreviewUnavailableText(errorMessage(error));
      surfaceNote = 'JSON 预览不可用';
    }
  } else {
    editorText = '';
    surfaceNote = 'JSON 未生成';
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
) {
  if (candidate.kind === 'rton') {
    const bytes = new Uint8Array(await candidate.file.arrayBuffer());
    const useHexSurface = preferredEditorSurface === 'hex';
	    const { value, encrypted, compact } = decodeRtonSourceValue(bytes, false);
	    const binaryEncoding = { compact, encrypted };
    const label = loadableFileKindLabel(preferredViewMode);
    const editorText = useHexSurface ? '' : `正在后台生成 ${label} 预览...`;
    const textSurfaceNote = useHexSurface ? `${label} 未生成` : `正在生成 ${label} 预览`;
    if (preferredViewMode === 'json') {
      return {
        value,
        editorText,
        surfaceNote: useHexSurface ? 'RTON 可编辑' : textSurfaceNote,
	        sourceBytes: bytes,
	        binaryBytes: bytes,
	        binaryEncoding,
	        viewMode: 'json' as const,
        editorSurface: useHexSurface ? ('hex' as const) : ('text' as const),
        status: { message: encrypted ? '加密 RTON 已解密并解析' : 'RTON 已解析', tone: 'ok' as const },
        needsTextPreview: !useHexSurface,
      };
    }

	    let preferredEditorText: string;
	    let preferredSurfaceNote: string;
	    if (useHexSurface) {
	      preferredEditorText = '';
	      preferredSurfaceNote = `${label} 未生成`;
	    } else {
	      preferredEditorText = editorText;
	      preferredSurfaceNote = textSurfaceNote;
	    }

    return {
      value,
      editorText: preferredEditorText,
      surfaceNote: useHexSurface ? 'RTON 可编辑' : preferredSurfaceNote,
	      sourceBytes: bytes,
	      binaryBytes: bytes,
	      binaryEncoding,
		      viewMode: preferredViewMode,
	      editorSurface: useHexSurface ? ('hex' as const) : ('text' as const),
	      status: { message: encrypted ? '加密 RTON 已解密并解析' : 'RTON 已解析', tone: 'ok' as const },
	      needsTextPreview: !useHexSurface,
	    };
  }

  const text = await candidate.file.text();
  if (candidate.kind === 'json') {
    return {
      value: parseJsonTextToRtonValue(text),
      editorText: text,
      surfaceNote: 'JSON 可编辑',
	      sourceBytes: null,
	      binaryBytes: null,
	      binaryEncoding: null,
	      viewMode: 'json' as const,
      editorSurface: 'text' as const,
      status: { message: 'JSON 已解析', tone: 'ok' as const },
    };
  }

  const { parseStructuredText } = await import('./format-conversion');
  const { value } = parseStructuredText(text, candidate.kind);
  const label = loadableFileKindLabel(candidate.kind);
  return {
    value,
    editorText: text,
    surfaceNote: `${label} 可编辑`,
	    sourceBytes: null,
	    binaryBytes: null,
	    binaryEncoding: null,
	    viewMode: candidate.kind,
    editorSurface: 'text' as const,
    status: { message: `${label} 已解析`, tone: 'ok' as const },
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
      throw new Error('文件列表项已失效');
    }
    return (await decodeLoadableSource(entry)).value;
  }

  throw new Error('当前标签页没有可导出的 RtonValue');
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

function formatDuration(milliseconds: number) {
  if (milliseconds < 1000) {
    return `${Math.round(milliseconds)} ms`;
  }
  return `${(milliseconds / 1000).toFixed(1)} s`;
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

function fileTabClass(active: boolean) {
  return cx(
    'rton-file-tab flex h-[31px] w-[180px] min-w-[104px] max-w-[240px] items-center overflow-hidden rounded-t-md border border-b-0 text-sm transition-colors',
    active
      ? 'border-[var(--color-accent-border)] bg-[var(--color-stage)] text-[var(--color-text-strong)]'
      : 'border-[var(--color-border-strong)] bg-[var(--color-control)] text-[var(--color-text)] hover:bg-[var(--color-control-hover)]',
  );
}

function fileListItemClass(active: boolean) {
  return cx(
    'flex min-w-0 items-center overflow-hidden rounded border transition-colors',
    active
      ? 'border-[var(--color-accent-border)] bg-[var(--color-control-active)] text-[var(--color-text-strong)]'
      : 'border-[var(--color-border)] bg-[var(--color-surface-soft)] text-[var(--color-text)] hover:border-[var(--color-border-strong)] hover:bg-[var(--color-control-hover)]',
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
}): EditorTab {
  try {
	    const plainValue = rtonValueToJsonValue(value);
	    const actualBinaryBytes = binaryBytes ?? sourceBytes;
	    let text = editorText;
    let note = surfaceNote ?? `${viewMode.toUpperCase()} 可编辑`;
    if (text === undefined) {
      try {
        text = rtonValueToJsonText(value, true);
      } catch (error) {
        text = jsonPreviewUnavailableText(errorMessage(error));
        note = 'JSON 预览不可用';
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
      surfaceNote: surfaceNote ?? `${viewMode.toUpperCase()} 解析失败`,
      searchQuery: '',
      searchState: { kind: 'message', message },
      status: { message, tone: 'error' },
    };
  }
}
