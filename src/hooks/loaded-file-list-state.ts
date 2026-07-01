import { useCallback, useEffect, useMemo, useState } from 'react';
import type { EditorTab } from '../workspace/editor-tabs';
import type { Translator } from '../localization/i18n';
import type { EditorSurface, ViewMode } from '../domain/rton-codec';
import {
  buildLoadedFileItems,
  filterLoadedFileItems,
  type LoadedRtonFile,
} from '../files/loaded-file-items';
import type { HexByteSource } from '../domain/hex-byte-source';

export function useLoadedFileListState({
  activeTabId,
  editorSurface,
  fileName,
  lang,
  loadedFiles,
  hexByteSource,
  sourceBytes,
  tabs,
  t,
  viewMode,
}: {
  activeTabId: number | null;
  editorSurface: EditorSurface;
  fileName: string;
  lang: string;
  loadedFiles: LoadedRtonFile[];
  hexByteSource: HexByteSource | null;
  sourceBytes: Uint8Array | null;
  tabs: EditorTab[];
  t: Translator;
  viewMode: ViewMode;
}) {
  const [selectedFileKeys, setSelectedFileKeys] = useState<Set<string>>(() => new Set());
  const [fileSearchQuery, setFileSearchQuery] = useState('');

  const loadedFileItems = useMemo(
    () => buildLoadedFileItems({ files: loadedFiles, tabs, activeTabId, fileName, sourceBytes, hexByteSource, viewMode, editorSurface, t }),
    [activeTabId, editorSurface, fileName, hexByteSource, lang, loadedFiles, sourceBytes, tabs, viewMode, t],
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

  return {
    clearSelectedFiles,
    fileListSubtitle,
    fileSearchActive,
    fileSearchQuery,
    filteredLoadedFileItems,
    listedFileCount,
    loadedFileItems,
    selectAllListedFiles,
    selectedFileCount,
    selectedFileKeys,
    selectedVisibleFileCount,
    setFileSearchQuery,
    toggleSelectedFile,
    toggleSelectedFiles,
    visibleFileCount,
  };
}
