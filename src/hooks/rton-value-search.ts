import { useCallback, useEffect, useRef, useState } from 'react';
import type { Translator } from '../localization/i18n';
import type { RtonValue } from '../domain/rton-value';
import { runChunkedSearch } from '../domain/rton-value-analysis';
import type { SearchState } from '../domain/rton-value-editing';

export function useRtonValueSearch({
  activeTabId,
  currentValue,
  debounceMs,
  parseError,
  t,
}: {
  activeTabId: number | null;
  currentValue: RtonValue | null;
  debounceMs: number;
  parseError: string | null;
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

    if (!currentValue) {
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
      runChunkedSearch(currentValue, query, searchId, activeSearchId, setSearchState);
    }, debounceMs);

    return cancelSearch;
  }, [activeTabId, cancelSearch, currentValue, debounceMs, parseError, searchQuery, t]);

  return {
    cancelSearch,
    searchQuery,
    searchState,
    setSearchQuery,
    setSearchState,
  };
}
