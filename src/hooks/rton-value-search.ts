import { useCallback, useEffect, useRef, useState } from 'react';
import type { Translator } from '../localization/i18n';
import type { RtonValue } from '../domain/rton-value';
import { RTON_SEARCH_MATCH_LIMIT, runChunkedSearch } from '../domain/rton-value-analysis';
import type { SearchState } from '../domain/rton-value-editing';
import type { RtonDocumentRef } from '../domain/rton-document';
import type { RtonDocumentSearchOutput } from './worker-clients';

export function useRtonValueSearch({
  activeTabId,
  currentValue,
  debounceMs,
  parseError,
  rtonDocument,
  searchRtonDocument,
  t,
}: {
  activeTabId: number | null;
  currentValue: RtonValue | null;
  debounceMs: number;
  parseError: string | null;
  rtonDocument: RtonDocumentRef | null;
  searchRtonDocument: (documentId: number, query: string, limit: number) => Promise<RtonDocumentSearchOutput>;
  t: Translator;
}) {
  const [searchQuery, setSearchQuery] = useState('');
  const [searchState, setSearchState] = useState<SearchState>(() => ({ kind: 'message', message: t('app.emptyFile') }));
  const searchTimer = useRef<number | null>(null);
  const activeSearchId = useRef(0);

  const cancelSearch = useCallback(() => {
    if (searchTimer.current !== null) {
      window.clearTimeout(searchTimer.current);
      searchTimer.current = null;
    }
    activeSearchId.current += 1;
  }, []);

  useEffect(() => {
    cancelSearch();

    if (activeTabId === null) {
      setSearchState({ kind: 'message', message: t('app.emptyFile') });
      return cancelSearch;
    }

    const query = searchQuery.trim().toLowerCase();
    if (parseError) {
      setSearchState({ kind: 'message', message: parseError });
      return cancelSearch;
    }

    if (!currentValue && !rtonDocument) {
      setSearchState({ kind: 'message', message: t('status.noSearchableValue') });
      return cancelSearch;
    }

    if (!query) {
      setSearchState({ kind: 'idle' });
      return cancelSearch;
    }

    setSearchState({ kind: 'message', message: t('status.searching', { query }) });
    const searchId = activeSearchId.current + 1;
    activeSearchId.current = searchId;
    searchTimer.current = window.setTimeout(() => {
      if (currentValue) {
        runChunkedSearch(currentValue, query, searchId, activeSearchId, setSearchState);
        return;
      }

      if (!rtonDocument) {
        return;
      }

      void searchRtonDocument(rtonDocument.id, query, RTON_SEARCH_MATCH_LIMIT)
        .then((result) => {
          if (searchId !== activeSearchId.current) {
            return;
          }
          setSearchState({
            kind: 'results',
            query,
            matches: result.matches,
            scanned: result.scanned,
            done: result.done,
            capped: result.capped,
          });
        })
        .catch((error: unknown) => {
          if (searchId === activeSearchId.current) {
            setSearchState({ kind: 'message', message: errorMessage(error) });
          }
        });
    }, debounceMs);

    return cancelSearch;
  }, [activeTabId, cancelSearch, currentValue, debounceMs, parseError, rtonDocument, searchQuery, searchRtonDocument, t]);

  return {
    cancelSearch,
    searchQuery,
    searchState,
    setSearchQuery,
    setSearchState,
  };
}

function errorMessage(error: unknown) {
  return error instanceof Error ? error.message : String(error);
}
