import {
  useEffect,
  useRef,
  useState,
  type DragEvent as ReactDragEvent,
  type MouseEvent as ReactMouseEvent,
} from 'react';
import { useI18n } from '../localization/use-i18n';

export type TabDropPlacement = 'before' | 'after';

type DropMarker<T extends string | number> = { id: T; placement: TabDropPlacement };

export type EditorTabStripItem = {
  id: number;
  fileName: string;
};

export function EditorTabStrip({
  tabs,
  activeTabId,
  fileName,
  onActivate,
  onClose,
  onMove,
}: {
  tabs: readonly EditorTabStripItem[];
  activeTabId: number | null;
  fileName: string;
  onActivate: (tabId: number) => void;
  onClose: (tabId: number) => void;
  onMove: (tabId: number, targetTabId: number, placement: TabDropPlacement) => void;
}) {
  const { t } = useI18n();
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
    const placement: TabDropPlacement = event.clientX < rect.left + rect.width / 2 ? 'before' : 'after';
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
      <div role="tablist" aria-label={t('tabs.openFiles')} className="rton-file-tabs" onDragOver={moveDraggedTabInContainer}>
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
                title={t('tabs.switchTo', { name: fullName })}
                className="min-w-0 flex-1 border-0 bg-transparent px-2.5 text-left text-inherit focus-visible:outline-none"
                onClick={() => onActivate(tab.id)}
              >
                <span className="block overflow-hidden text-ellipsis whitespace-nowrap">{displayName}</span>
              </button>
              <button
                type="button"
                title={t('tabs.close')}
                aria-label={t('tabs.close')}
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

export function reorderTabs<T extends { id: number }>(
  tabs: readonly T[],
  draggedId: number,
  targetId: number,
  placement: TabDropPlacement,
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

function isSameDropMarker<T extends string | number>(a: DropMarker<T> | null, b: DropMarker<T> | null): boolean {
  if (a === b) {
    return true;
  }
  if (!a || !b) {
    return false;
  }
  return a.id === b.id && a.placement === b.placement;
}

function isCurrentPlacement<T extends { id: number }>(
  items: readonly T[],
  draggedId: number,
  targetId: number,
  placement: TabDropPlacement,
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

function leafDisplayName(path: string) {
  const normalized = path.replace(/\\/g, '/').replace(/^\/+/, '');
  const parts = normalized.split('/').filter(Boolean);
  return parts.at(-1) ?? path;
}

function fileTabClass(active: boolean) {
  return cx(
    'rton-file-tab flex h-[31px] w-[180px] min-w-[104px] max-w-[240px] items-center overflow-hidden rounded-t-md border border-b-0 text-sm transition-colors',
    active
      ? 'border-[var(--color-accent-border)] bg-[var(--color-stage)] text-[var(--color-text-strong)]'
      : 'border-[var(--color-border-strong)] bg-[var(--color-control)] text-[var(--color-text)] hover:bg-[var(--color-control-hover)]',
  );
}

function cx(...classes: Array<string | false | null | undefined>) {
  return classes.filter(Boolean).join(' ');
}
