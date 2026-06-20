import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ClipboardEvent,
  type CSSProperties,
  type KeyboardEvent,
} from 'react';

type PendingHexEdit = {
  offset: number;
  text: string;
};

type HexEditorProps = {
  bytes: Uint8Array;
  bytesPerRow?: number;
  jumpTarget: HexEditorJumpTarget | null;
  readOnly?: boolean;
  searchPanelVisible: boolean;
  onChange: (bytes: Uint8Array) => void;
  onSearchPanelVisibleChange: (visible: boolean) => void;
};

export type HexEditorJumpTarget = {
  id: number;
  offset: number;
};

type HexSearchMode = 'hex' | 'ascii';
type BytePattern = {
  bytes: number[];
  valid: boolean;
  message: string;
};
type HexSearchMatch = {
  offset: number;
  length: number;
};
type HexSearchResult = {
  matches: HexSearchMatch[];
  capped: boolean;
  pending: boolean;
};

const ROW_HEIGHT = 28;
const OVERSCAN_ROWS = 8;
const SEARCH_MATCH_DISPLAY_LIMIT = 5000;
const HEX_SEARCH_CHUNK_BYTES = 240_000;
const HEX_SEARCH_FRAME_BUDGET_MS = 8;
const MAX_VIRTUAL_SCROLL_HEIGHT = 8_000_000;
const HEX_CHAR_RE = /^[0-9a-fA-F]$/;

export function HexEditor({
  bytes,
  bytesPerRow = 16,
  jumpTarget,
  readOnly = false,
  searchPanelVisible,
  onChange,
  onSearchPanelVisibleChange,
}: HexEditorProps) {
  const scrollerRef = useRef<HTMLDivElement | null>(null);
  const searchInputRef = useRef<HTMLInputElement | null>(null);
  const hexInputRefs = useRef(new Map<number, HTMLInputElement>());
  const asciiInputRefs = useRef(new Map<number, HTMLInputElement>());
  const activePane = useRef<'hex' | 'ascii'>('hex');
  const searchRunId = useRef(0);
  const [scrollTop, setScrollTop] = useState(0);
  const [viewportHeight, setViewportHeight] = useState(0);
  const [selectedOffset, setSelectedOffset] = useState(0);
  const [pendingEdit, setPendingEdit] = useState<PendingHexEdit | null>(null);
  const [insertMode, setInsertMode] = useState(false);
  const [searchMode, setSearchMode] = useState<HexSearchMode>('hex');
  const [searchQuery, setSearchQuery] = useState('');
  const [replaceQuery, setReplaceQuery] = useState('');
  const [caseSensitive, setCaseSensitive] = useState(true);
  const [searchMatches, setSearchMatches] = useState<HexSearchResult>(() => emptySearchResult());
  const rowCount = Math.ceil(bytes.length / bytesPerRow);
  const totalContentHeight = rowCount * ROW_HEIGHT;
  const virtualContentHeight = Math.min(totalContentHeight, MAX_VIRTUAL_SCROLL_HEIGHT);
  const scrollScale =
    totalContentHeight > virtualContentHeight && virtualContentHeight > viewportHeight
      ? (totalContentHeight - viewportHeight) / Math.max(1, virtualContentHeight - viewportHeight)
      : 1;
  const logicalScrollTop = scrollTop * scrollScale;
  const offsetColumnWidth = Math.max(8, Math.max(0, bytes.length - 1).toString(16).length) + 2;
  const searchPattern = useMemo(() => parseSearchPattern(searchMode, searchQuery), [searchMode, searchQuery]);
  const replacePattern = useMemo(() => parseReplacePattern(searchMode, replaceQuery), [searchMode, replaceQuery]);
  const currentSearchMatch = useMemo(
    () => searchMatches.matches.find((match) => selectedOffset >= match.offset && selectedOffset < match.offset + match.length) ?? null,
    [searchMatches.matches, selectedOffset],
  );
  const currentSearchMatchIndex = useMemo(() => {
    if (!currentSearchMatch) {
      return -1;
    }
    return searchMatches.matches.findIndex((match) => match.offset === currentSearchMatch.offset && match.length === currentSearchMatch.length);
  }, [currentSearchMatch, searchMatches.matches]);
  const searchStatusText = useMemo(() => {
    if (searchQuery.length === 0) {
      return '输入搜索内容';
    }
    if (!searchPattern.valid) {
      return searchPattern.message;
    }
    if (searchMatches.pending) {
      return searchMatches.matches.length > 0 ? `搜索中 · ${searchMatches.matches.length.toLocaleString()} 个匹配` : '搜索中...';
    }
    if (searchMatches.matches.length === 0) {
      return '无匹配';
    }

    const totalText = searchMatches.capped
      ? `${searchMatches.matches.length.toLocaleString()}+`
      : searchMatches.matches.length.toLocaleString();
    if (currentSearchMatchIndex >= 0) {
      return `${(currentSearchMatchIndex + 1).toLocaleString()} / ${totalText}`;
    }
    return `${totalText} 个匹配`;
  }, [
    currentSearchMatchIndex,
    searchMatches.capped,
    searchMatches.matches.length,
    searchMatches.pending,
    searchPattern.message,
    searchPattern.valid,
    searchQuery.length,
  ]);
  const searchPanelStatusText =
    replaceQuery.length > 0 && !replacePattern.valid ? replacePattern.message : searchStatusText;

  useEffect(() => {
    const scroller = scrollerRef.current;
    if (!scroller) {
      return;
    }

    const updateViewportHeight = () => setViewportHeight(scroller.clientHeight);
    updateViewportHeight();
    const observer = new ResizeObserver(updateViewportHeight);
    observer.observe(scroller);
    return () => observer.disconnect();
  }, []);

  useEffect(() => {
    if (bytes.length === 0) {
      setSelectedOffset(0);
      setPendingEdit(null);
      return;
    }
    if (selectedOffset >= bytes.length) {
      setSelectedOffset(bytes.length - 1);
    }
  }, [bytes.length, selectedOffset]);

  useEffect(() => {
    const runId = searchRunId.current + 1;
    searchRunId.current = runId;

    if (
      !searchPanelVisible ||
      !searchPattern.valid ||
      searchPattern.bytes.length === 0 ||
      bytes.length < searchPattern.bytes.length
    ) {
      setSearchMatches(emptySearchResult());
      return;
    }

    const patternBytes = searchPattern.bytes;
    const asciiInsensitive = searchMode === 'ascii' && !caseSensitive;
    const patternLength = patternBytes.length;
    const maxOffset = bytes.length - patternLength;
    const matches: HexSearchMatch[] = [];
    let offset = 0;
    let timer: number | null = null;
    let cancelled = false;

    setSearchMatches({ matches: [], capped: false, pending: true });

    const finish = (capped: boolean) => {
      if (cancelled || searchRunId.current !== runId) {
        return;
      }
      setSearchMatches({ matches: [...matches], capped, pending: false });
    };

    const step = () => {
      if (cancelled || searchRunId.current !== runId) {
        return;
      }

      const startedAt = performance.now();
      const chunkEnd = Math.min(maxOffset, offset + HEX_SEARCH_CHUNK_BYTES);
      while (offset <= chunkEnd) {
        if (matchesAt(bytes, offset, patternBytes, asciiInsensitive)) {
          if (matches.length >= SEARCH_MATCH_DISPLAY_LIMIT) {
            finish(true);
            return;
          }
          matches.push({ offset, length: patternLength });
          offset += patternLength;
        } else {
          offset += 1;
        }

        if (performance.now() - startedAt >= HEX_SEARCH_FRAME_BUDGET_MS) {
          break;
        }
      }

      if (offset > maxOffset) {
        finish(false);
        return;
      }

      timer = window.setTimeout(step, 0);
    };

    timer = window.setTimeout(step, 0);
    return () => {
      cancelled = true;
      if (timer !== null) {
        window.clearTimeout(timer);
      }
    };
  }, [bytes, caseSensitive, searchMode, searchPanelVisible, searchPattern]);

  const visibleRange = useMemo(() => {
    if (rowCount === 0) {
      return { startRow: 0, endRow: 0 };
    }

    const startRow = Math.max(0, Math.floor(logicalScrollTop / ROW_HEIGHT) - OVERSCAN_ROWS);
    const endRow = Math.min(rowCount, Math.ceil((logicalScrollTop + viewportHeight) / ROW_HEIGHT) + OVERSCAN_ROWS);
    return { startRow, endRow };
  }, [logicalScrollTop, rowCount, viewportHeight]);

  const rowToScrollTop = useCallback(
    (rowIndex: number) => {
      const logicalTop = rowIndex * ROW_HEIGHT;
      const maxScrollTop = Math.max(0, virtualContentHeight - viewportHeight);
      return clampNumber(scrollScale === 1 ? logicalTop : logicalTop / scrollScale, 0, maxScrollTop);
    },
    [scrollScale, viewportHeight, virtualContentHeight],
  );

  const focusOffsetInLength = useCallback(
    (offset: number, length: number, pane = activePane.current) => {
      if (length === 0) {
        return;
      }

      const nextOffset = clampNumber(offset, 0, length - 1);
      setSelectedOffset(nextOffset);
      requestAnimationFrame(() => {
        const inputRefs = pane === 'ascii' ? asciiInputRefs : hexInputRefs;
        const input = inputRefs.current.get(nextOffset);
        if (input) {
          input.focus();
          input.select();
          return;
        }

        const scroller = scrollerRef.current;
        if (!scroller) {
          return;
        }
        scroller.scrollTop = rowToScrollTop(Math.floor(nextOffset / bytesPerRow));
        requestAnimationFrame(() => {
          const nextInput = inputRefs.current.get(nextOffset);
          nextInput?.focus();
          nextInput?.select();
        });
      });
    },
    [bytesPerRow, rowToScrollTop],
  );

  const focusOffset = useCallback(
    (offset: number) => {
      focusOffsetInLength(offset, bytes.length);
    },
    [bytes.length, focusOffsetInLength],
  );

  const showSearchPanel = useCallback(() => {
    onSearchPanelVisibleChange(true);
    requestAnimationFrame(() => searchInputRef.current?.focus());
  }, [onSearchPanelVisibleChange]);

  const hideSearchPanel = useCallback(() => {
    onSearchPanelVisibleChange(false);
  }, [onSearchPanelVisibleChange]);

  useEffect(() => {
    if (!searchPanelVisible) {
      return;
    }
    requestAnimationFrame(() => searchInputRef.current?.focus());
  }, [searchPanelVisible]);

  const focusSearchMatch = useCallback(
    (match: HexSearchMatch | null) => {
      if (!match) {
        return;
      }

      const pane = searchMode === 'ascii' ? 'ascii' : 'hex';
      activePane.current = pane;
      focusOffsetInLength(match.offset, bytes.length, pane);
    },
    [bytes.length, focusOffsetInLength, searchMode],
  );

  const findRelativeSearchMatch = useCallback(
    (direction: 'next' | 'previous') => {
      const matches = searchMatches.matches;
      if (matches.length === 0) {
        return null;
      }

      if (direction === 'next') {
        const threshold = currentSearchMatch ? currentSearchMatch.offset : selectedOffset - 1;
        return matches.find((match) => match.offset > threshold) ?? matches[0];
      }

      const threshold = currentSearchMatch ? currentSearchMatch.offset : selectedOffset + 1;
      for (let index = matches.length - 1; index >= 0; index -= 1) {
        if (matches[index].offset < threshold) {
          return matches[index];
        }
      }
      return matches.at(-1) ?? null;
    },
    [currentSearchMatch, searchMatches.matches, selectedOffset],
  );

  const goToNextSearchMatch = useCallback(() => {
    focusSearchMatch(findRelativeSearchMatch('next'));
  }, [findRelativeSearchMatch, focusSearchMatch]);

  const goToPreviousSearchMatch = useCallback(() => {
    focusSearchMatch(findRelativeSearchMatch('previous'));
  }, [findRelativeSearchMatch, focusSearchMatch]);

  const replaceByteSpan = useCallback(
    (offset: number, deleteLength: number, values: number[]) => {
      if (readOnly) {
        return;
      }
      const safeOffset = clampNumber(offset, 0, bytes.length);
      const safeDeleteLength = Math.min(Math.max(0, deleteLength), bytes.length - safeOffset);
      const nextBytes = new Uint8Array(bytes.length - safeDeleteLength + values.length);
      nextBytes.set(bytes.slice(0, safeOffset), 0);
      nextBytes.set(values.map((value) => value & 0xff), safeOffset);
      nextBytes.set(bytes.slice(safeOffset + safeDeleteLength), safeOffset + values.length);

      onChange(nextBytes);
      setPendingEdit(null);
      const pane = searchMode === 'ascii' ? 'ascii' : 'hex';
      activePane.current = pane;
      focusOffsetInLength(values.length > 0 ? safeOffset : Math.min(safeOffset, nextBytes.length - 1), nextBytes.length, pane);
    },
    [bytes, focusOffsetInLength, onChange, readOnly, searchMode],
  );

  const replaceCurrentSearchMatch = useCallback(() => {
    if (!searchPattern.valid || !replacePattern.valid || searchPattern.bytes.length === 0) {
      return;
    }

    const match = currentSearchMatch ?? findRelativeSearchMatch('next');
    if (!match) {
      return;
    }

    replaceByteSpan(match.offset, match.length, replacePattern.bytes);
  }, [currentSearchMatch, findRelativeSearchMatch, replaceByteSpan, replacePattern.bytes, replacePattern.valid, searchPattern.bytes.length, searchPattern.valid]);

  const replaceAllSearchMatches = useCallback(() => {
    if (!searchPattern.valid || !replacePattern.valid || searchPattern.bytes.length === 0) {
      return;
    }

    const asciiInsensitive = searchMode === 'ascii' && !caseSensitive;
    const patternLength = searchPattern.bytes.length;
    const replacementBytes = Uint8Array.from(replacePattern.bytes.map((value) => value & 0xff));
    let replaceCount = 0;

    for (let offset = 0; offset <= bytes.length - patternLength;) {
      if (matchesAt(bytes, offset, searchPattern.bytes, asciiInsensitive)) {
        replaceCount += 1;
        offset += patternLength;
      } else {
        offset += 1;
      }
    }

    if (replaceCount === 0) {
      return;
    }

    const nextLength = bytes.length + replaceCount * (replacementBytes.length - patternLength);
    const nextBytes = new Uint8Array(nextLength);
    let readOffset = 0;
    let writeOffset = 0;

    for (let offset = 0; offset <= bytes.length - patternLength;) {
      if (matchesAt(bytes, offset, searchPattern.bytes, asciiInsensitive)) {
        nextBytes.set(bytes.subarray(readOffset, offset), writeOffset);
        writeOffset += offset - readOffset;
        nextBytes.set(replacementBytes, writeOffset);
        writeOffset += replacementBytes.length;
        offset += patternLength;
        readOffset = offset;
      } else {
        offset += 1;
      }
    }
    nextBytes.set(bytes.subarray(readOffset), writeOffset);

    onChange(nextBytes);
    setPendingEdit(null);
    const pane = searchMode === 'ascii' ? 'ascii' : 'hex';
    activePane.current = pane;
    focusOffsetInLength(Math.min(selectedOffset, nextBytes.length - 1), nextBytes.length, pane);
  }, [
    bytes,
    caseSensitive,
    focusOffsetInLength,
    onChange,
    replacePattern.bytes,
    replacePattern.valid,
    searchMode,
    searchPattern.bytes,
    searchPattern.valid,
    selectedOffset,
  ]);

  const handleEditorKeyDown = useCallback(
    (event: KeyboardEvent<HTMLDivElement>) => {
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 'f') {
        event.preventDefault();
        showSearchPanel();
      }
    },
    [showSearchPanel],
  );

  const handleSearchInputKeyDown = useCallback(
    (event: KeyboardEvent<HTMLInputElement>) => {
      if (event.key === 'Enter') {
        event.preventDefault();
        if (event.shiftKey) {
          goToPreviousSearchMatch();
        } else {
          goToNextSearchMatch();
        }
      } else if (event.key === 'Escape') {
        event.preventDefault();
        hideSearchPanel();
      }
    },
    [goToNextSearchMatch, goToPreviousSearchMatch, hideSearchPanel],
  );

  const handleReplaceInputKeyDown = useCallback(
    (event: KeyboardEvent<HTMLInputElement>) => {
      if (event.key === 'Enter') {
        event.preventDefault();
        replaceCurrentSearchMatch();
      } else if (event.key === 'Escape') {
        event.preventDefault();
        hideSearchPanel();
      }
    },
    [hideSearchPanel, replaceCurrentSearchMatch],
  );

  const setByte = useCallback(
    (offset: number, value: number) => {
      if (readOnly || offset < 0 || offset >= bytes.length) {
        return;
      }

      const nextBytes = new Uint8Array(bytes);
      nextBytes[offset] = value & 0xff;
      onChange(nextBytes);
      setSelectedOffset(offset);
    },
    [bytes, onChange, readOnly],
  );

  const replaceByteRange = useCallback(
    (offset: number, values: number[]) => {
      if (readOnly || values.length === 0 || offset >= bytes.length) {
        return;
      }

      const nextBytes = new Uint8Array(bytes);
      const writableLength = Math.min(values.length, bytes.length - offset);
      for (let index = 0; index < writableLength; index += 1) {
        nextBytes[offset + index] = values[index] & 0xff;
      }
      onChange(nextBytes);
      setPendingEdit(null);
      focusOffsetInLength(offset + writableLength, nextBytes.length);
    },
    [bytes, focusOffsetInLength, onChange, readOnly],
  );

  const insertByteRange = useCallback(
    (offset: number, values: number[]) => {
      if (readOnly || values.length === 0) {
        return;
      }

      const insertOffset = clampNumber(offset, 0, bytes.length);
      const nextBytes = new Uint8Array(bytes.length + values.length);
      nextBytes.set(bytes.slice(0, insertOffset), 0);
      nextBytes.set(values.map((value) => value & 0xff), insertOffset);
      nextBytes.set(bytes.slice(insertOffset), insertOffset + values.length);
      onChange(nextBytes);
      setPendingEdit(null);
      focusOffsetInLength(insertOffset + values.length, nextBytes.length);
    },
    [bytes, focusOffsetInLength, onChange, readOnly],
  );

  const setByteRange = useCallback(
    (offset: number, values: number[]) => {
      if (insertMode) {
        insertByteRange(offset, values);
      } else {
        replaceByteRange(offset, values);
      }
    },
    [insertByteRange, insertMode, replaceByteRange],
  );

  const deleteByteRange = useCallback(
    (offset: number, count: number, nextFocusOffset = offset) => {
      if (readOnly || count <= 0 || offset < 0 || offset >= bytes.length) {
        return;
      }

      const deleteCount = Math.min(count, bytes.length - offset);
      const nextBytes = new Uint8Array(bytes.length - deleteCount);
      nextBytes.set(bytes.slice(0, offset), 0);
      nextBytes.set(bytes.slice(offset + deleteCount), offset);
      onChange(nextBytes);
      setPendingEdit(null);
      focusOffsetInLength(nextFocusOffset, nextBytes.length);
    },
    [bytes, focusOffsetInLength, onChange, readOnly],
  );

  const commitPendingEdit = useCallback(
    (offset: number) => {
      if (pendingEdit?.offset !== offset) {
        return;
      }

      const text = pendingEdit.text.trim();
      setPendingEdit(null);
      if (readOnly || text.length === 0) {
        return;
      }
      setByteRange(offset, [parseInt(text, 16)]);
    },
    [pendingEdit, readOnly, setByteRange],
  );

  const handleTextChange = useCallback(
    (offset: number, rawText: string) => {
      if (readOnly) {
        setPendingEdit(null);
        return;
      }
      const text = rawText.replace(/[^0-9a-f]/gi, '').slice(0, 2).toUpperCase();
      setSelectedOffset(offset);
      if (text.length < 2) {
        setPendingEdit({ offset, text });
        return;
      }

      setPendingEdit(null);
      setByteRange(offset, [parseInt(text, 16)]);
    },
    [readOnly, setByteRange],
  );

  const handleKeyDown = useCallback(
    (event: KeyboardEvent<HTMLInputElement>, offset: number) => {
      const key = event.key;
      if ((event.metaKey || event.ctrlKey) && key.toLowerCase() === 'f') {
        event.preventDefault();
        showSearchPanel();
        return;
      }
      if (readOnly && (key === 'Insert' || key === 'Backspace' || key === 'Delete' || key === 'Enter' || (key.length === 1 && HEX_CHAR_RE.test(key)))) {
        event.preventDefault();
        setPendingEdit(null);
        return;
      }
      if (key === 'Insert') {
        event.preventDefault();
        setPendingEdit(null);
        setInsertMode((current) => !current);
        return;
      }
      if (key === 'ArrowLeft') {
        event.preventDefault();
        setPendingEdit(null);
        focusOffset(offset - 1);
        return;
      }
      if (key === 'ArrowRight') {
        event.preventDefault();
        setPendingEdit(null);
        focusOffset(offset + 1);
        return;
      }
      if (key === 'ArrowUp') {
        event.preventDefault();
        setPendingEdit(null);
        focusOffset(offset - bytesPerRow);
        return;
      }
      if (key === 'ArrowDown') {
        event.preventDefault();
        setPendingEdit(null);
        focusOffset(offset + bytesPerRow);
        return;
      }
      if (key === 'Home') {
        event.preventDefault();
        setPendingEdit(null);
        focusOffset(Math.floor(offset / bytesPerRow) * bytesPerRow);
        return;
      }
      if (key === 'End') {
        event.preventDefault();
        setPendingEdit(null);
        focusOffset(Math.min(Math.floor(offset / bytesPerRow) * bytesPerRow + bytesPerRow - 1, bytes.length - 1));
        return;
      }
      if (key === 'Backspace') {
        event.preventDefault();
        if (pendingEdit?.offset === offset && pendingEdit.text.length > 0) {
          setPendingEdit({ offset, text: '' });
        } else if (insertMode) {
          deleteByteRange(offset - 1, 1, offset - 1);
        } else {
          setByte(offset, 0);
        }
        return;
      }
      if (key === 'Delete') {
        event.preventDefault();
        setPendingEdit(null);
        if (insertMode) {
          deleteByteRange(offset, 1, offset);
        } else {
          setByte(offset, 0);
        }
        return;
      }
      if (key === 'Escape') {
        setPendingEdit(null);
        event.currentTarget.blur();
        return;
      }
      if (key === 'Enter') {
        event.preventDefault();
        commitPendingEdit(offset);
        focusOffset(offset + 1);
        return;
      }
      if (key.length === 1 && HEX_CHAR_RE.test(key)) {
        event.preventDefault();
        const currentText = pendingEdit?.offset === offset ? pendingEdit.text : '';
        const nextText = `${currentText}${key.toUpperCase()}`.slice(0, 2);
        if (nextText.length < 2) {
          setPendingEdit({ offset, text: nextText });
          setSelectedOffset(offset);
          return;
        }

        setPendingEdit(null);
        setByteRange(offset, [parseInt(nextText, 16)]);
      }
    },
    [
      bytes.length,
      bytesPerRow,
      commitPendingEdit,
      deleteByteRange,
      focusOffset,
      insertMode,
      pendingEdit,
      readOnly,
      setByte,
      setByteRange,
      showSearchPanel,
    ],
  );

  const handlePaste = useCallback(
    (event: ClipboardEvent<HTMLInputElement>, offset: number) => {
      const pairs = event.clipboardData.getData('text').match(/[0-9a-fA-F]{2}/g);
      if (readOnly || !pairs || pairs.length === 0) {
        return;
      }

      event.preventDefault();
      setByteRange(
        offset,
        pairs.map((pair) => parseInt(pair, 16)),
      );
    },
    [readOnly, setByteRange],
  );

  const handleAsciiChange = useCallback(
    (offset: number, rawText: string) => {
      if (readOnly) {
        return;
      }
      if (rawText.length === 0) {
        if (insertMode) {
          deleteByteRange(offset, 1, offset);
        } else {
          setByte(offset, 0);
        }
        return;
      }

      const nextChar = Array.from(rawText).at(-1) ?? '';
      if (nextChar.length === 0) {
        return;
      }

      const codePoint = nextChar.codePointAt(0);
      if (codePoint === undefined || codePoint > 0xff) {
        return;
      }

      setPendingEdit(null);
      setByteRange(offset, [codePoint]);
    },
    [deleteByteRange, insertMode, readOnly, setByte, setByteRange],
  );

  const handleAsciiKeyDown = useCallback(
    (event: KeyboardEvent<HTMLInputElement>, offset: number) => {
      const key = event.key;
      if ((event.metaKey || event.ctrlKey) && key.toLowerCase() === 'f') {
        event.preventDefault();
        showSearchPanel();
        return;
      }
      if (readOnly && (key === 'Insert' || key === 'Backspace' || key === 'Delete')) {
        event.preventDefault();
        setPendingEdit(null);
        return;
      }
      if (key === 'Insert') {
        event.preventDefault();
        setInsertMode((current) => !current);
        return;
      }
      if (key === 'ArrowLeft') {
        event.preventDefault();
        focusOffset(offset - 1);
        return;
      }
      if (key === 'ArrowRight') {
        event.preventDefault();
        focusOffset(offset + 1);
        return;
      }
      if (key === 'ArrowUp') {
        event.preventDefault();
        focusOffset(offset - bytesPerRow);
        return;
      }
      if (key === 'ArrowDown') {
        event.preventDefault();
        focusOffset(offset + bytesPerRow);
        return;
      }
      if (key === 'Home') {
        event.preventDefault();
        focusOffset(Math.floor(offset / bytesPerRow) * bytesPerRow);
        return;
      }
      if (key === 'End') {
        event.preventDefault();
        focusOffset(Math.min(Math.floor(offset / bytesPerRow) * bytesPerRow + bytesPerRow - 1, bytes.length - 1));
        return;
      }
      if (key === 'Backspace' || key === 'Delete') {
        event.preventDefault();
        setPendingEdit(null);
        if (insertMode) {
          if (key === 'Backspace') {
            deleteByteRange(offset - 1, 1, offset - 1);
          } else {
            deleteByteRange(offset, 1, offset);
          }
        } else {
          setByte(offset, 0);
        }
        return;
      }
      if (key === 'Escape') {
        event.currentTarget.blur();
      }
    },
    [bytes.length, bytesPerRow, deleteByteRange, focusOffset, insertMode, readOnly, setByte, showSearchPanel],
  );

  const handleAsciiPaste = useCallback(
    (event: ClipboardEvent<HTMLInputElement>, offset: number) => {
      const text = event.clipboardData.getData('text');
      if (readOnly || !text) {
        return;
      }

      const values = Array.from(text)
        .map((char) => char.codePointAt(0))
        .filter((codePoint): codePoint is number => codePoint !== undefined && codePoint <= 0xff);
      if (values.length === 0) {
        return;
      }

      event.preventDefault();
      setByteRange(offset, values);
    },
    [readOnly, setByteRange],
  );

  useEffect(() => {
    if (!jumpTarget) {
      return;
    }
    focusOffset(jumpTarget.offset);
  }, [focusOffset, jumpTarget]);

  const headerCells = Array.from({ length: bytesPerRow }, (_, column) => column.toString(16).toUpperCase().padStart(2, '0'));
  const rows = [];
  for (let rowIndex = visibleRange.startRow; rowIndex < visibleRange.endRow; rowIndex += 1) {
    rows.push(rowIndex);
  }

  const style = {
    '--rton-hex-columns': String(bytesPerRow),
    '--rton-hex-offset-width': `${offsetColumnWidth}ch`,
    '--rton-hex-ascii-width': `${bytesPerRow}ch`,
  } as CSSProperties;
  const searchControlsDisabled = searchMatches.pending || !searchPattern.valid || searchMatches.matches.length === 0;
  const replaceControlsDisabled = searchControlsDisabled || !replacePattern.valid;

  if (bytes.length === 0) {
    return (
      <div className="rton-hex-editor" style={style}>
        <div className="rton-hex-empty">没有可编辑的字节</div>
      </div>
    );
  }

  return (
    <div className="rton-hex-editor" style={style} onKeyDown={handleEditorKeyDown}>
      <div className="rton-hex-summary">
        <span>{bytes.length.toLocaleString()} bytes</span>
        <span>Offset {toOffsetHex(selectedOffset, offsetColumnWidth - 2)}</span>
        <span>Value 0x{byteToHex(bytes[selectedOffset] ?? 0)}</span>
        <button
          type="button"
          disabled={readOnly}
          className={insertMode ? 'rton-hex-mode-button is-active' : 'rton-hex-mode-button'}
          onClick={() => {
            setPendingEdit(null);
            setInsertMode((current) => !current);
          }}
        >
          {readOnly ? '只读' : insertMode ? '插入' : '覆写'}
        </button>
      </div>
      <div className="rton-hex-header" aria-hidden="true">
        <span className="rton-hex-offset">OFFSET</span>
        <div className="rton-hex-grid">
          {headerCells.map((label) => (
            <span key={label} className="rton-hex-column-label">
              {label}
            </span>
          ))}
        </div>
        <span className="rton-hex-ascii-label">ASCII</span>
      </div>
      <div
        ref={scrollerRef}
        className="rton-hex-scroll"
        onScroll={(event) => setScrollTop(event.currentTarget.scrollTop)}
      >
        <div className="rton-hex-virtual-space" style={{ height: virtualContentHeight }}>
          {rows.map((rowIndex) => {
            const rowStart = rowIndex * bytesPerRow;
            const rowTop = scrollScale === 1 ? rowIndex * ROW_HEIGHT : scrollTop + rowIndex * ROW_HEIGHT - logicalScrollTop;
            const rowBytes = Array.from({ length: bytesPerRow }, (_, column) => rowStart + column);
            return (
              <div key={rowIndex} className="rton-hex-row" style={{ transform: `translateY(${rowTop}px)` }}>
                <span className="rton-hex-offset">{toOffsetHex(rowStart, offsetColumnWidth - 2)}</span>
                <div className="rton-hex-grid">
                  {rowBytes.map((offset) => {
                    if (offset >= bytes.length) {
                      return <span key={offset} className="rton-hex-byte-placeholder" />;
                    }

                    const pendingText = pendingEdit?.offset === offset ? pendingEdit.text : null;
                    const searchMatch = findContainingMatch(searchMatches.matches, offset);
                    const isCurrentSearchMatch =
                      currentSearchMatch !== null &&
                      offset >= currentSearchMatch.offset &&
                      offset < currentSearchMatch.offset + currentSearchMatch.length;
                    return (
                      <input
                        key={offset}
                        ref={(node) => {
                          if (node) {
                            hexInputRefs.current.set(offset, node);
                          } else {
                            hexInputRefs.current.delete(offset);
                          }
                        }}
                        value={pendingText ?? byteToHex(bytes[offset])}
                        aria-label={`Byte ${toOffsetHex(offset, offsetColumnWidth - 2)}`}
                        className={classNames(
                          'rton-hex-byte',
                          selectedOffset === offset && 'is-selected',
                          searchMatch && 'is-search-match',
                          isCurrentSearchMatch && 'is-current-match',
                        )}
                        inputMode="text"
                        readOnly={readOnly}
                        spellCheck={false}
                        onFocus={(event) => {
                          activePane.current = 'hex';
                          setSelectedOffset(offset);
                          event.currentTarget.select();
                        }}
                        onChange={(event) => handleTextChange(offset, event.currentTarget.value)}
                        onBlur={() => commitPendingEdit(offset)}
                        onKeyDown={(event) => handleKeyDown(event, offset)}
                        onPaste={(event) => handlePaste(event, offset)}
                      />
                    );
                  })}
                </div>
                <div className="rton-hex-ascii">
                  {rowBytes.map((offset) => {
                    if (offset >= bytes.length) {
                      return <span key={offset} className="rton-hex-ascii-placeholder" />;
                    }
                    const searchMatch = findContainingMatch(searchMatches.matches, offset);
                    const isCurrentSearchMatch =
                      currentSearchMatch !== null &&
                      offset >= currentSearchMatch.offset &&
                      offset < currentSearchMatch.offset + currentSearchMatch.length;
                    return (
                      <input
                        key={offset}
                        ref={(node) => {
                          if (node) {
                            asciiInputRefs.current.set(offset, node);
                          } else {
                            asciiInputRefs.current.delete(offset);
                          }
                        }}
                        value={byteToAscii(bytes[offset])}
                        aria-label={`ASCII byte ${toOffsetHex(offset, offsetColumnWidth - 2)}`}
                        className={classNames(
                          'rton-hex-ascii-char',
                          selectedOffset === offset && 'is-selected',
                          searchMatch && 'is-search-match',
                          isCurrentSearchMatch && 'is-current-match',
                        )}
                        inputMode="text"
                        readOnly={readOnly}
                        spellCheck={false}
                        onFocus={(event) => {
                          activePane.current = 'ascii';
                          setSelectedOffset(offset);
                          event.currentTarget.select();
                        }}
                        onChange={(event) => handleAsciiChange(offset, event.currentTarget.value)}
                        onKeyDown={(event) => handleAsciiKeyDown(event, offset)}
                        onPaste={(event) => handleAsciiPaste(event, offset)}
                      />
                    );
                  })}
                </div>
              </div>
            );
          })}
        </div>
      </div>
      {searchPanelVisible && (
        <div className="rton-hex-search-panel">
          <div className="rton-hex-search-mode" role="group" aria-label="搜索模式">
            <button
              type="button"
              className={searchMode === 'hex' ? 'rton-hex-search-mode-button is-active' : 'rton-hex-search-mode-button'}
              onClick={() => setSearchMode('hex')}
            >
              HEX
            </button>
            <button
              type="button"
              className={searchMode === 'ascii' ? 'rton-hex-search-mode-button is-active' : 'rton-hex-search-mode-button'}
              onClick={() => setSearchMode('ascii')}
            >
              ASCII
            </button>
          </div>
          <input
            ref={searchInputRef}
            value={searchQuery}
            className="rton-hex-search-field"
            placeholder={searchMode === 'hex' ? '搜索 HEX' : '搜索 ASCII'}
            spellCheck={false}
            onChange={(event) => setSearchQuery(event.currentTarget.value)}
            onKeyDown={handleSearchInputKeyDown}
          />
          <button
            type="button"
            className="rton-hex-search-button"
            disabled={searchControlsDisabled}
            onClick={goToPreviousSearchMatch}
          >
            上一个
          </button>
          <button
            type="button"
            className="rton-hex-search-button"
            disabled={searchControlsDisabled}
            onClick={goToNextSearchMatch}
          >
            下一个
          </button>
          <label className="rton-hex-search-check">
            <input
              type="checkbox"
              checked={caseSensitive}
              disabled={searchMode !== 'ascii'}
              onChange={(event) => setCaseSensitive(event.currentTarget.checked)}
            />
            大小写
          </label>
          <input
            value={replaceQuery}
            className="rton-hex-search-field"
            placeholder={searchMode === 'hex' ? '替换 HEX' : '替换 ASCII'}
            spellCheck={false}
            onChange={(event) => setReplaceQuery(event.currentTarget.value)}
            onKeyDown={handleReplaceInputKeyDown}
          />
          <button
            type="button"
            className="rton-hex-search-button"
            disabled={replaceControlsDisabled}
            onClick={replaceCurrentSearchMatch}
          >
            替换
          </button>
          <button
            type="button"
            className="rton-hex-search-button"
            disabled={replaceControlsDisabled}
            onClick={replaceAllSearchMatches}
          >
            全部替换
          </button>
          <span className="rton-hex-search-status">{searchPanelStatusText}</span>
          <button type="button" className="rton-hex-search-close" aria-label="关闭搜索栏" onClick={hideSearchPanel}>
            ×
          </button>
        </div>
      )}
    </div>
  );
}

function byteToHex(byte: number) {
  return byte.toString(16).toUpperCase().padStart(2, '0');
}

function toOffsetHex(offset: number, width: number) {
  return offset.toString(16).toUpperCase().padStart(width, '0');
}

function byteToAscii(byte: number) {
  return byte >= 0x20 && byte <= 0x7e ? String.fromCharCode(byte) : '.';
}

function clampNumber(value: number, min: number, max: number) {
  return Math.min(max, Math.max(min, value));
}

function parseSearchPattern(mode: HexSearchMode, text: string): BytePattern {
  return mode === 'hex' ? parseHexPattern(text, false) : parseAsciiPattern(text, false);
}

function parseReplacePattern(mode: HexSearchMode, text: string): BytePattern {
  return mode === 'hex' ? parseHexPattern(text, true) : parseAsciiPattern(text, true);
}

function parseHexPattern(text: string, allowEmpty: boolean): BytePattern {
  const compact = text.trim().replace(/0x/gi, '').replace(/[\s,_:-]+/g, '');
  if (compact.length === 0) {
    return allowEmpty
      ? { bytes: [], valid: true, message: '' }
      : { bytes: [], valid: false, message: '请输入 HEX' };
  }
  if (!/^[0-9a-fA-F]+$/.test(compact)) {
    return { bytes: [], valid: false, message: 'HEX 只能包含 0-9/A-F' };
  }
  if (compact.length % 2 !== 0) {
    return { bytes: [], valid: false, message: 'HEX 长度必须为偶数' };
  }

  const bytes = [];
  for (let index = 0; index < compact.length; index += 2) {
    bytes.push(parseInt(compact.slice(index, index + 2), 16));
  }
  return { bytes, valid: true, message: '' };
}

function parseAsciiPattern(text: string, allowEmpty: boolean): BytePattern {
  if (text.length === 0) {
    return allowEmpty
      ? { bytes: [], valid: true, message: '' }
      : { bytes: [], valid: false, message: '请输入 ASCII' };
  }

  const bytes = latin1BytesFromText(text);
  if (!bytes) {
    return { bytes: [], valid: false, message: 'ASCII 只能使用 0-255 字符' };
  }
  return { bytes, valid: true, message: '' };
}

function latin1BytesFromText(text: string) {
  const bytes = [];
  for (const char of Array.from(text)) {
    const codePoint = char.codePointAt(0);
    if (codePoint === undefined || codePoint > 0xff) {
      return null;
    }
    bytes.push(codePoint);
  }
  return bytes;
}

function emptySearchResult(): HexSearchResult {
  return { matches: [], capped: false, pending: false };
}

function matchesAt(bytes: Uint8Array, offset: number, pattern: number[], asciiInsensitive: boolean) {
  if (offset < 0 || offset + pattern.length > bytes.length) {
    return false;
  }

  for (let index = 0; index < pattern.length; index += 1) {
    const left = bytes[offset + index];
    const right = pattern[index];
    if (asciiInsensitive) {
      if (lowerAsciiByte(left) !== lowerAsciiByte(right)) {
        return false;
      }
    } else if (left !== right) {
      return false;
    }
  }
  return true;
}

function lowerAsciiByte(byte: number) {
  return byte >= 0x41 && byte <= 0x5a ? byte + 0x20 : byte;
}

function findContainingMatch(matches: HexSearchMatch[], offset: number) {
  let low = 0;
  let high = matches.length - 1;
  let candidate: HexSearchMatch | null = null;

  while (low <= high) {
    const middle = Math.floor((low + high) / 2);
    const match = matches[middle];
    if (match.offset <= offset) {
      candidate = match;
      low = middle + 1;
    } else {
      high = middle - 1;
    }
  }

  return candidate && offset < candidate.offset + candidate.length ? candidate : null;
}

function classNames(...values: Array<string | false | null | undefined>) {
  return values.filter(Boolean).join(' ');
}
