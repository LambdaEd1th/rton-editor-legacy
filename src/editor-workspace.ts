import { reorderTabs, type TabDropPlacement } from './components/EditorTabStrip';
import type { EditorTab } from './editor-tabs';
import type { LoadedRtonFile } from './loaded-file-items';
import type { JsonValue, RtonBinaryEncoding, StatusState, ViewMode, EditorSurface } from './rton-codec';
import type { RtonValue } from './rton-value';
import type { Stats } from './rton-value-analysis';
import type { SearchState } from './rton-value-editing';

export type EditorTabSnapshotInput = {
  activeTabId: number | null;
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

export type EditorTabCloseResult = {
  closeIndex: number;
  closed: boolean;
  nextActive: EditorTab | null;
  nextTabs: EditorTab[];
};

export function createActiveEditorTabSnapshot(input: EditorTabSnapshotInput): EditorTab | null {
  if (input.activeTabId === null) {
    return null;
  }

  return {
    id: input.activeTabId,
    fileName: input.fileName,
    sourceBytes: input.sourceBytes,
    binaryBytes: input.binaryBytes,
    binaryEncoding: input.binaryEncoding,
    currentValue: input.currentValue,
    editorText: input.editorText,
    lastOutputBytes: input.lastOutputBytes,
    parsedJson: input.parsedJson,
    parseError: input.parseError,
    stats: input.stats,
    viewMode: input.viewMode,
    editorSurface: input.editorSurface,
    surfaceNote: input.surfaceNote,
    searchQuery: input.searchQuery,
    searchState: input.searchState,
    status: input.status,
  };
}

export function syncActiveEditorTab(tabs: EditorTab[], snapshot: EditorTab | null) {
  if (!snapshot) {
    return tabs;
  }
  return tabs.map((tab) => (tab.id === snapshot.id ? snapshot : tab));
}

export function appendEditorTabs(tabs: EditorTab[], newTabs: EditorTab[], snapshot: EditorTab | null) {
  if (newTabs.length === 0) {
    return { nextActive: null, nextTabs: tabs };
  }

  return {
    nextActive: newTabs[newTabs.length - 1],
    nextTabs: [...syncActiveEditorTab(tabs, snapshot), ...newTabs],
  };
}

export function findEditorTab(tabs: EditorTab[], tabId: number) {
  return tabs.find((tab) => tab.id === tabId) ?? null;
}

export function closeEditorTabState(
  tabs: EditorTab[],
  tabId: number,
  activeTabId: number | null,
): EditorTabCloseResult {
  const closeIndex = tabs.findIndex((tab) => tab.id === tabId);
  if (closeIndex === -1) {
    return { closeIndex, closed: false, nextActive: null, nextTabs: tabs };
  }

  const nextTabs = tabs.filter((tab) => tab.id !== tabId);
  const nextActive = tabId === activeTabId
    ? tabs[closeIndex + 1] ?? tabs[closeIndex - 1] ?? nextTabs[0] ?? null
    : null;
  return { closeIndex, closed: true, nextActive, nextTabs };
}

export function moveEditorTabState(
  tabs: EditorTab[],
  tabId: number,
  targetTabId: number,
  placement: TabDropPlacement,
) {
  if (tabId === targetTabId || tabs.length < 2) {
    return tabs;
  }
  return reorderTabs(tabs, tabId, targetTabId, placement);
}

export function unlinkLoadedFileTab(files: LoadedRtonFile[], tabId: number) {
  return files.map((file) => (file.tabId === tabId ? { ...file, tabId: null } : file));
}
