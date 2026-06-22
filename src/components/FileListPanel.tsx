import { CheckCheck, FileArchive, Search, Square } from 'lucide-react';
import type { BatchExportMode } from '../batch-export';
import { LoadedFilesTree, type LoadedFileTreeItem } from './LoadedFilesTree';
import { PanelHeader } from './Panels';
import type { Translator } from '../localization/i18n';
import { buttonClass } from '../ui-classes';

export function FileListPanel({
  t,
  fileListSubtitle,
  fileSearchActive,
  fileSearchQuery,
  filteredLoadedFileItems,
  listedFileCount,
  selectedFileCount,
  selectedFileKeys,
  selectedVisibleFileCount,
  visibleFileCount,
  wasmReady,
  onActivate,
  onBatchExport,
  onClearSearch,
  onClearSelectedFiles,
  onClose,
  onOpenFile,
  onSearchChange,
  onSelectAllListedFiles,
  onToggleSelected,
  onToggleSelectedMany,
}: {
  t: Translator;
  fileListSubtitle: string;
  fileSearchActive: boolean;
  fileSearchQuery: string;
  filteredLoadedFileItems: LoadedFileTreeItem[];
  listedFileCount: number;
  selectedFileCount: number;
  selectedFileKeys: Set<string>;
  selectedVisibleFileCount: number;
  visibleFileCount: number;
  wasmReady: boolean;
  onActivate: (tabId: number) => void;
  onBatchExport: (mode: BatchExportMode) => void;
  onClearSearch: () => void;
  onClearSelectedFiles: () => void;
  onClose: (tabId: number) => void;
  onOpenFile: (fileId: number) => void;
  onSearchChange: (value: string) => void;
  onSelectAllListedFiles: () => void;
  onToggleSelected: (key: string, selected: boolean) => void;
  onToggleSelectedMany: (keys: string[], selected: boolean) => void;
}) {
  return (
    <aside className="rton-side-panel rton-side-panel-left">
      <PanelHeader
        icon={<FileArchive />}
        title={t('fileList.title')}
        subtitle={fileListSubtitle}
        actions={
          <>
            <button type="button" onClick={onSelectAllListedFiles} disabled={visibleFileCount === 0} className={buttonClass('secondary')}>
              <CheckCheck />
              {t('fileList.selectAll')}
            </button>
            <button type="button" onClick={onClearSelectedFiles} disabled={selectedVisibleFileCount === 0} className={buttonClass('secondary')}>
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
                onClick={() => onBatchExport(mode)}
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
            onChange={(event) => onSearchChange(event.currentTarget.value)}
            onKeyDown={(event) => {
              if (event.key === 'Escape') {
                onClearSearch();
              }
            }}
          />
          {fileSearchQuery && (
            <button
              type="button"
              aria-label={t('fileList.clearSearch')}
              className="absolute right-1 top-1 grid h-5 w-5 place-items-center rounded border-0 bg-transparent text-[var(--color-text-muted)] hover:bg-[var(--color-border)] hover:text-[var(--color-text-strong)] focus-visible:outline-none"
              onClick={onClearSearch}
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
          onOpenFile={onOpenFile}
          onActivate={onActivate}
          onClose={onClose}
          onToggleSelected={onToggleSelected}
          onToggleSelectedMany={onToggleSelectedMany}
        />
      </section>
    </aside>
  );
}
