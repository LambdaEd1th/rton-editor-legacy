import type { LoadedFileTreeItem } from './components/LoadedFilesTree';
import type { EditorTab } from './editor-tabs';
import {
  loadableFileKindLabel,
  splitDisplayPath,
  type LoadableFileKind,
} from './file-loading';
import { formatBytes } from './file-export';
import type { Translator } from './localization/i18n';
import type { EditorSurface, ViewMode } from './rton-codec';

export type LoadedRtonFile = {
  id: number;
  file: File;
  kind: LoadableFileKind;
  path: string;
  tabId: number | null;
};

export function buildLoadedFileItems({
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

export function filterLoadedFileItems(items: LoadedFileTreeItem[], query: string) {
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
