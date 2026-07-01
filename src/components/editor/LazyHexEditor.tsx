import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
} from 'react';
import { useI18n } from '../../localization/use-i18n';
import type { HexByteSource } from '../../domain/hex-byte-source';
import type { HexEditorJumpTarget } from './HexEditor';

type LazyHexEditorProps = {
  source: HexByteSource;
  bytesPerRow?: number;
  jumpTarget: HexEditorJumpTarget | null;
  searchPanelVisible: boolean;
  readRange: (source: HexByteSource, start: number, end: number) => Promise<Uint8Array>;
  onSearchPanelVisibleChange: (visible: boolean) => void;
};

type LoadedRange = {
  start: number;
  end: number;
  bytes: Uint8Array;
};

const ROW_HEIGHT = 28;
const OVERSCAN_ROWS = 10;
const DEFAULT_VIEWPORT_HEIGHT = 720;
const MAX_VIRTUAL_SCROLL_HEIGHT = 8_000_000;
const CHUNK_SIZE = 256 * 1024;
const PREFETCH_ROWS = 24;

export function LazyHexEditor({
  source,
  bytesPerRow = 16,
  jumpTarget,
  searchPanelVisible,
  readRange,
  onSearchPanelVisibleChange,
}: LazyHexEditorProps) {
  const { t } = useI18n();
  const editorRef = useRef<HTMLDivElement | null>(null);
  const scrollerRef = useRef<HTMLDivElement | null>(null);
  const loadRunId = useRef(0);
  const [scrollTop, setScrollTop] = useState(0);
  const [viewportHeight, setViewportHeight] = useState(0);
  const [selectedOffset, setSelectedOffset] = useState(0);
  const [loadedRange, setLoadedRange] = useState<LoadedRange | null>(null);
  const [loading, setLoading] = useState(false);

  const byteLength = source.byteLength;
  const rowCount = Math.ceil(byteLength / bytesPerRow);
  const totalContentHeight = rowCount * ROW_HEIGHT;
  const effectiveViewportHeight =
    viewportHeight > 0
      ? viewportHeight
      : Math.max(ROW_HEIGHT * 24, Math.floor((typeof window === 'undefined' ? DEFAULT_VIEWPORT_HEIGHT : window.innerHeight) * 0.6));
  const virtualContentHeight = Math.min(totalContentHeight, MAX_VIRTUAL_SCROLL_HEIGHT);
  const scrollScale =
    totalContentHeight > virtualContentHeight && virtualContentHeight > effectiveViewportHeight
      ? (totalContentHeight - effectiveViewportHeight) / Math.max(1, virtualContentHeight - effectiveViewportHeight)
      : 1;
  const logicalScrollTop = scrollTop * scrollScale;
  const offsetColumnWidth = Math.max(8, Math.max(0, byteLength - 1).toString(16).length) + 2;

  const updateViewportHeight = useCallback(() => {
    const scroller = scrollerRef.current;
    const editor = editorRef.current;
    const clientHeight = scroller?.clientHeight ?? 0;
    const rectHeight = scroller?.getBoundingClientRect().height ?? 0;
    const editorHeight = editor?.getBoundingClientRect().height ?? 0;
    const fallbackHeight = Math.max(0, editorHeight - 31 - (searchPanelVisible ? 46 : 0));
    const nextHeight = Math.floor(Math.max(clientHeight, rectHeight, fallbackHeight));
    setViewportHeight((current) => (current === nextHeight ? current : nextHeight));
  }, [searchPanelVisible]);

  useLayoutEffect(() => {
    updateViewportHeight();
    const firstFrame = window.requestAnimationFrame(updateViewportHeight);
    const secondFrame = window.requestAnimationFrame(() => window.requestAnimationFrame(updateViewportHeight));
    const timeout = window.setTimeout(updateViewportHeight, 0);
    const observer = new ResizeObserver(updateViewportHeight);
    if (scrollerRef.current) {
      observer.observe(scrollerRef.current);
    }
    if (editorRef.current) {
      observer.observe(editorRef.current);
    }
    window.addEventListener('resize', updateViewportHeight);
    return () => {
      window.cancelAnimationFrame(firstFrame);
      window.cancelAnimationFrame(secondFrame);
      window.clearTimeout(timeout);
      window.removeEventListener('resize', updateViewportHeight);
      observer.disconnect();
    };
  }, [updateViewportHeight]);

  const visibleRange = useMemo(() => {
    if (rowCount === 0) {
      return { startRow: 0, endRow: 0 };
    }
    const startRow = Math.max(0, Math.floor(logicalScrollTop / ROW_HEIGHT) - OVERSCAN_ROWS);
    const endRow = Math.min(rowCount, Math.ceil((logicalScrollTop + effectiveViewportHeight) / ROW_HEIGHT) + OVERSCAN_ROWS);
    return { startRow, endRow };
  }, [effectiveViewportHeight, logicalScrollTop, rowCount]);

  const rows = useMemo(() => {
    const nextRows: number[] = [];
    for (let rowIndex = visibleRange.startRow; rowIndex < visibleRange.endRow; rowIndex += 1) {
      nextRows.push(rowIndex);
    }
    return nextRows;
  }, [visibleRange.endRow, visibleRange.startRow]);

  useEffect(() => {
    loadRunId.current += 1;
    setLoadedRange(null);
  }, [source]);

  const rowToScrollTop = useCallback(
    (rowIndex: number) => {
      const logicalTop = rowIndex * ROW_HEIGHT;
      const maxScrollTop = Math.max(0, virtualContentHeight - effectiveViewportHeight);
      return clampNumber(scrollScale === 1 ? logicalTop : logicalTop / scrollScale, 0, maxScrollTop);
    },
    [effectiveViewportHeight, scrollScale, virtualContentHeight],
  );

  useEffect(() => {
    const firstByte = Math.max(0, (visibleRange.startRow - PREFETCH_ROWS) * bytesPerRow);
    const lastByte = Math.min(byteLength, (visibleRange.endRow + PREFETCH_ROWS) * bytesPerRow);
    const start = Math.max(0, Math.floor(firstByte / CHUNK_SIZE) * CHUNK_SIZE);
    const end = Math.min(byteLength, Math.ceil(lastByte / CHUNK_SIZE) * CHUNK_SIZE);
    if (loadedRange && start >= loadedRange.start && end <= loadedRange.end) {
      return;
    }

    const runId = loadRunId.current + 1;
    loadRunId.current = runId;
    setLoading(true);
    readRange(source, start, end)
      .then((bytes) => {
        if (loadRunId.current === runId) {
          setLoadedRange({ start, end: start + bytes.byteLength, bytes });
        }
      })
      .finally(() => {
        if (loadRunId.current === runId) {
          setLoading(false);
        }
      });
  }, [byteLength, bytesPerRow, loadedRange, readRange, source, visibleRange.endRow, visibleRange.startRow]);

  useEffect(() => {
    if (!jumpTarget || byteLength === 0) {
      return;
    }
    const offset = clampNumber(jumpTarget.offset, 0, byteLength - 1);
    setSelectedOffset(offset);
    requestAnimationFrame(() => {
      const scroller = scrollerRef.current;
      if (scroller) {
        scroller.scrollTop = rowToScrollTop(Math.floor(offset / bytesPerRow));
      }
    });
  }, [byteLength, bytesPerRow, jumpTarget, rowToScrollTop]);

  const byteAt = useCallback(
    (offset: number) => {
      if (!loadedRange || offset < loadedRange.start || offset >= loadedRange.end) {
        return null;
      }
      return loadedRange.bytes[offset - loadedRange.start] ?? null;
    },
    [loadedRange],
  );

  const selectedByte = byteAt(selectedOffset);
  const headerCells = Array.from({ length: bytesPerRow }, (_, column) => column.toString(16).toUpperCase().padStart(2, '0'));
  const style = {
    '--rton-hex-columns': String(bytesPerRow),
    '--rton-hex-offset-width': `${offsetColumnWidth}ch`,
    '--rton-hex-ascii-width': `${bytesPerRow}ch`,
    '--rton-hex-inspector-width': '310px',
  } as CSSProperties;

  return (
    <div ref={editorRef} className="rton-hex-editor" style={style}>
      <div className="rton-hex-summary">
        <span>{byteLength.toLocaleString()} bytes</span>
        <span>Offset {toOffsetHex(selectedOffset, offsetColumnWidth - 2)}</span>
        <span>Value {selectedByte === null ? '--' : `0x${byteToHex(selectedByte)}`}</span>
        {loading && <span>{t('hex.lazyLoading')}</span>}
        <button type="button" disabled className="rton-hex-mode-button">
          {t('hex.lazyReadOnly')}
        </button>
      </div>
      <div className="rton-hex-body">
        <div className="rton-hex-table-pane">
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
          <div ref={scrollerRef} className="rton-hex-scroll" onScroll={(event) => setScrollTop(event.currentTarget.scrollTop)}>
            <div className="rton-hex-virtual-space" style={{ height: virtualContentHeight }}>
              {rows.map((rowIndex) => {
                const rowStart = rowIndex * bytesPerRow;
                const rowTop = scrollScale === 1 ? rowIndex * ROW_HEIGHT : scrollTop + rowIndex * ROW_HEIGHT - logicalScrollTop;
                const rowBytes = Array.from({ length: bytesPerRow }, (_, column) => rowStart + column);
                return (
                  <div key={rowIndex} className="rton-hex-row" style={{ transform: `translateY(${rowTop}px)` }}>
                    <button type="button" className="rton-hex-offset rton-hex-offset-button" onClick={() => setSelectedOffset(rowStart)}>
                      {toOffsetHex(rowStart, offsetColumnWidth - 2)}
                    </button>
                    <div className="rton-hex-grid">
                      {rowBytes.map((offset) => {
                        if (offset >= byteLength) {
                          return <span key={offset} className="rton-hex-byte-placeholder" />;
                        }
                        const value = byteAt(offset);
                        return (
                          <button
                            key={offset}
                            type="button"
                            className={classNames('rton-hex-byte', selectedOffset === offset && 'is-selected')}
                            onClick={() => setSelectedOffset(offset)}
                          >
                            {value === null ? '..' : byteToHex(value)}
                          </button>
                        );
                      })}
                    </div>
                    <div className="rton-hex-ascii">
                      {rowBytes.map((offset) => {
                        if (offset >= byteLength) {
                          return <span key={offset} className="rton-hex-ascii-placeholder" />;
                        }
                        const value = byteAt(offset);
                        return (
                          <button
                            key={offset}
                            type="button"
                            className={classNames('rton-hex-ascii-char', selectedOffset === offset && 'is-selected')}
                            onClick={() => setSelectedOffset(offset)}
                          >
                            {value === null ? ' ' : byteToAscii(value)}
                          </button>
                        );
                      })}
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        </div>
        <div className="rton-hex-inspector-resize-handle" aria-hidden="true" />
        <LazyHexInspector byteLength={byteLength} offset={selectedOffset} value={selectedByte} />
      </div>
      {searchPanelVisible && (
        <div className="rton-hex-search-panel">
          <span className="rton-hex-search-status">{t('hex.lazySearchUnavailable')}</span>
          <button type="button" className="rton-hex-search-close" aria-label={t('hex.closeSearch')} onClick={() => onSearchPanelVisibleChange(false)}>
            ×
          </button>
        </div>
      )}
    </div>
  );
}

function LazyHexInspector({ byteLength, offset, value }: { byteLength: number; offset: number; value: number | null }) {
  const { t } = useI18n();
  if (value === null) {
    return (
      <aside className="rton-hex-inspector">
        <div className="rton-hex-inspector-empty">{t('hex.lazyLoading')}</div>
      </aside>
    );
  }

  return (
    <aside className="rton-hex-inspector">
      <header className="rton-hex-inspector-header">
        <h2>{t('hexInspector.title')}</h2>
        <span>0x{toOffsetHex(offset, 8)}</span>
      </header>
      <InspectorSection title={t('hexInspector.offset')}>
        <InspectorRow label={t('hexInspector.offset')} value={`0x${toOffsetHex(offset, 8)}`} strong />
        <InspectorRow label={t('hexInspector.byte')} value={`0x${byteToHex(value)}`} />
        <InspectorRow label={t('hexInspector.decimal')} value={value} />
        <InspectorRow label={t('hexInspector.ascii')} value={byteToAscii(value)} />
        {offset < 4 && <InspectorRow label={t('hexInspector.region')} value="RTON header magic" />}
        {offset >= byteLength - 4 && <InspectorRow label={t('hexInspector.region')} value="RTON footer" />}
      </InspectorSection>
    </aside>
  );
}

function InspectorSection({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="rton-hex-inspector-section">
      <h3>{title}</h3>
      {children}
    </section>
  );
}

function InspectorRow({ label, value, strong = false }: { label: string; value: React.ReactNode; strong?: boolean }) {
  return (
    <div className="rton-hex-inspector-row">
      <span>{label}</span>
      <strong className={strong ? 'is-strong' : undefined}>{value}</strong>
    </div>
  );
}

function toOffsetHex(offset: number, width: number) {
  return offset.toString(16).toUpperCase().padStart(width, '0');
}

function byteToHex(byte: number) {
  return byte.toString(16).toUpperCase().padStart(2, '0');
}

function byteToAscii(byte: number) {
  return byte >= 0x20 && byte <= 0x7e ? String.fromCharCode(byte) : '.';
}

function clampNumber(value: number, min: number, max: number) {
  return Math.min(max, Math.max(min, value));
}

function classNames(...values: Array<string | false | null | undefined>) {
  return values.filter(Boolean).join(' ');
}
