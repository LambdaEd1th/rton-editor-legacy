import { Activity, FileArchive, ListTree, Search } from 'lucide-react';
import type { Translator } from '../../localization/i18n';
import type { Stats } from '../../domain/rton-value-analysis';
import { RTON_SEARCH_MATCH_LIMIT } from '../../domain/rton-value-analysis';
import type { RtonValuePath, SearchState } from '../../domain/rton-value-editing';
import type { RtonValue } from '../../domain/rton-value';
import type { RtonDocumentRef } from '../../domain/rton-document';
import type { RtonDocumentChildrenOutput } from '../../hooks/worker-clients';
import { MetaItem, PanelHeader, Stat } from '../panels/Panels';
import { RtonValueInspector } from './RtonValueInspector';

export function RightInspectorPanel({
  t,
  currentValue,
  rtonDocument,
  displayFileName,
  hasActiveFile,
  inputText,
  outputText,
  searchQuery,
  searchState,
  stats,
  onError,
  onLoadDocumentChildren,
  onNavigate,
  onSearchChange,
  onValueChange,
}: {
  t: Translator;
  currentValue: RtonValue | null;
  rtonDocument: RtonDocumentRef | null;
  displayFileName: string;
  hasActiveFile: boolean;
  inputText: string;
  outputText: string;
  searchQuery: string;
  searchState: SearchState;
  stats: Stats;
  onError: (message: string) => void;
  onLoadDocumentChildren: (documentId: number, path: RtonValuePath, offset: number, limit: number) => Promise<RtonDocumentChildrenOutput>;
  onNavigate: (path: RtonValuePath) => void;
  onSearchChange: (value: string) => void;
  onValueChange: (path: RtonValuePath, value: RtonValue) => void;
}) {
  return (
    <aside className="rton-side-panel rton-side-panel-right">
      <div className="shrink-0 border-b border-[var(--color-border)]">
        <PanelHeader icon={<FileArchive />} title={t('panel.fileProperties')} subtitle={t('panel.currentFile')} />
        <section className="border-b border-[var(--color-border)] p-3">
          <dl className="grid gap-3 text-sm">
            <MetaItem label={t('panel.name')} value={displayFileName} />
            <MetaItem label={t('panel.input')} value={inputText} />
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
              onChange={(event) => onSearchChange(event.currentTarget.value)}
              onKeyDown={(event) => {
                if (event.key === 'Escape') {
                  onSearchChange('');
                }
              }}
            />
            {searchQuery && (
              <button
                type="button"
                aria-label={t('panel.clearIndexSearch')}
                className="absolute right-1 top-1 grid h-5 w-5 place-items-center rounded border-0 bg-transparent text-[var(--color-text-muted)] hover:bg-[var(--color-border)] hover:text-[var(--color-text-strong)] focus-visible:outline-none"
                onClick={() => onSearchChange('')}
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
              document={rtonDocument}
              searchMatchLimit={RTON_SEARCH_MATCH_LIMIT}
              loadDocumentChildren={onLoadDocumentChildren}
              onChange={onValueChange}
              onNavigate={onNavigate}
              onError={onError}
            />
          </div>
        </div>
      </div>
    </aside>
  );
}
