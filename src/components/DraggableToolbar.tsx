import {
  useEffect,
  useRef,
  useState,
  type DragEvent as ReactDragEvent,
  type MouseEvent as ReactMouseEvent,
  type ReactNode,
} from 'react';
import { GripVertical } from 'lucide-react';
import { useI18n } from '../localization/use-i18n';

export type ToolbarGroupId = 'file' | 'edit' | 'format' | 'textExport' | 'rtonExport' | 'prefs';

export type ToolbarGroupConfig = {
  label: string;
  content: ReactNode;
  role?: string;
  ariaLabel?: string;
};

type DropPlacement = 'before' | 'after';
type DropMarker<T extends string | number> = { id: T; placement: DropPlacement };
type ToolbarRows = ToolbarGroupId[][];
type ToolbarDropTarget =
  | { type: 'group'; id: ToolbarGroupId; placement: DropPlacement }
  | { type: 'row-end'; rowIndex: number };

const TOOLBAR_LAYOUT_KEY = 'rton-editor-toolbar-layout';
const TOOLBAR_GROUP_IDS: ToolbarGroupId[] = ['file', 'edit', 'format', 'textExport', 'rtonExport', 'prefs'];
const DEFAULT_TOOLBAR_ROWS: ToolbarRows = [
  ['file', 'edit', 'format'],
  ['textExport', 'rtonExport', 'prefs'],
];

export function DraggableToolbar({ groups }: { groups: Record<ToolbarGroupId, ToolbarGroupConfig> }) {
  const { t } = useI18n();
  const dragGroupIdRef = useRef<ToolbarGroupId | null>(null);
  const dragHandleIdRef = useRef<ToolbarGroupId | null>(null);
  const [rows, setRows] = useState<ToolbarRows>(() => readToolbarRows());
  const [draggedGroupId, setDraggedGroupId] = useState<ToolbarGroupId | null>(null);
  const [dropMarker, setDropMarker] = useState<DropMarker<ToolbarGroupId> | null>(null);

  useEffect(() => {
    try {
      localStorage.setItem(TOOLBAR_LAYOUT_KEY, JSON.stringify(rows));
    } catch (error) {
      console.warn('Failed to save toolbar layout:', error);
    }
  }, [rows]);

  const finishDrag = () => {
    dragGroupIdRef.current = null;
    dragHandleIdRef.current = null;
    setDraggedGroupId(null);
    setDropMarker(null);
  };

  const updateDropMarker = (marker: DropMarker<ToolbarGroupId> | null) => {
    setDropMarker((current) => (isSameDropMarker(current, marker) ? current : marker));
  };

  useEffect(() => {
    const clearHandleArm = () => {
      if (!dragGroupIdRef.current) {
        dragHandleIdRef.current = null;
      }
    };

    window.addEventListener('mouseup', clearHandleArm, true);
    window.addEventListener('blur', finishDrag);
    return () => {
      window.removeEventListener('mouseup', clearHandleArm, true);
      window.removeEventListener('blur', finishDrag);
    };
  }, []);

  const armDragHandle = (event: ReactMouseEvent<HTMLButtonElement>, id: ToolbarGroupId) => {
    if (event.button !== 0) {
      return;
    }
    dragHandleIdRef.current = id;
  };

  const startGroupDrag = (event: ReactDragEvent<HTMLDivElement>, id: ToolbarGroupId) => {
    if (dragHandleIdRef.current !== id) {
      event.preventDefault();
      return;
    }

    dragGroupIdRef.current = id;
    setDraggedGroupId(id);
    setDropMarker(null);
    event.dataTransfer.effectAllowed = 'move';
    event.dataTransfer.setData('text/plain', id);
  };

  const applyDropTarget = (event: ReactDragEvent<HTMLElement>, target: ToolbarDropTarget) => {
    const draggedId = dragGroupIdRef.current;
    if (!draggedId) {
      return;
    }

    event.preventDefault();
    event.stopPropagation();
    event.dataTransfer.dropEffect = 'move';

    if (target.type === 'group') {
      if (target.id === draggedId) {
        return;
      }
      updateDropMarker({ id: target.id, placement: target.placement });
      setRows((currentRows) => moveToolbarGroup(currentRows, draggedId, target.id, target.placement));
      return;
    }

    updateDropMarker(null);
    setRows((currentRows) => moveToolbarGroupToRowEnd(currentRows, draggedId, target.rowIndex));
  };

  const moveDraggedGroup = (event: ReactDragEvent<HTMLElement>, targetId: ToolbarGroupId) => {
    const draggedId = dragGroupIdRef.current;
    if (!draggedId || draggedId === targetId) {
      return;
    }

    const rect = event.currentTarget.getBoundingClientRect();
    const placement: DropPlacement = event.clientX < rect.left + rect.width / 2 ? 'before' : 'after';
    applyDropTarget(event, { type: 'group', id: targetId, placement });
  };

  const moveDraggedGroupInRow = (event: ReactDragEvent<HTMLDivElement>, rowIndex: number) => {
    const draggedId = dragGroupIdRef.current;
    if (!draggedId) {
      return;
    }

    const target = findToolbarRowDropTarget(event.currentTarget, event.clientX, event.clientY, draggedId) ?? {
      type: 'row-end' as const,
      rowIndex,
    };
    applyDropTarget(event, target);
  };

  return (
    <>
      {rows.map((row, rowIndex) => (
        <div
          key={rowIndex}
          className="rton-toolbar-row"
          data-toolbar-row-index={rowIndex}
          onDragOver={(event) => moveDraggedGroupInRow(event, rowIndex)}
          onDrop={(event) => {
            event.preventDefault();
            finishDrag();
          }}
        >
          {row.map((id) => {
            const group = groups[id];
            return (
              <div
                key={id}
                className={classNames(
                  'rton-toolbar-group-shell',
                  draggedGroupId === id && 'dragging',
                  dropMarker?.id === id && `drop-${dropMarker.placement}`,
                )}
                data-toolbar-group-id={id}
                draggable
                onDragStart={(event) => startGroupDrag(event, id)}
                onDragOver={(event) => moveDraggedGroup(event, id)}
                onDrop={(event) => {
                  event.preventDefault();
                  event.stopPropagation();
                  finishDrag();
                }}
                onDragEnd={finishDrag}
              >
                <button
                  type="button"
                  className="rton-toolbar-group-drag-handle"
                  title={t('toolbar.moveGroup', { label: group.label })}
                  aria-label={t('toolbar.moveGroup', { label: group.label })}
                  onMouseDown={(event) => armDragHandle(event, id)}
                >
                  <GripVertical aria-hidden="true" />
                </button>
                <div className="rton-toolbar-group" role={group.role} aria-label={group.ariaLabel}>
                  {group.content}
                </div>
              </div>
            );
          })}
        </div>
      ))}
    </>
  );
}

function cloneToolbarRows(rows: ToolbarRows): ToolbarRows {
  return rows.map((row) => [...row]);
}

function normalizeToolbarRows(value: unknown): ToolbarRows {
  const sourceRows = Array.isArray(value) ? value : DEFAULT_TOOLBAR_ROWS;
  const seen = new Set<ToolbarGroupId>();
  const rows: ToolbarRows = [[], []];

  sourceRows.forEach((row, rowIndex) => {
    if (!Array.isArray(row)) {
      return;
    }
    const targetRow = rows[Math.min(rowIndex, rows.length - 1)];
    row.forEach((id) => {
      if (typeof id !== 'string' || !isToolbarGroupId(id) || seen.has(id)) {
        return;
      }
      seen.add(id);
      targetRow.push(id);
    });
  });

  TOOLBAR_GROUP_IDS.forEach((id) => {
    if (!seen.has(id)) {
      rows[rows.length - 1].push(id);
    }
  });

  return rows;
}

function readToolbarRows(): ToolbarRows {
  try {
    return normalizeToolbarRows(JSON.parse(localStorage.getItem(TOOLBAR_LAYOUT_KEY) ?? 'null'));
  } catch {
    return cloneToolbarRows(DEFAULT_TOOLBAR_ROWS);
  }
}

function isToolbarGroupId(id: string): id is ToolbarGroupId {
  return (TOOLBAR_GROUP_IDS as string[]).includes(id);
}

function moveToolbarGroup(rows: ToolbarRows, groupId: ToolbarGroupId, targetId: ToolbarGroupId, placement: DropPlacement): ToolbarRows {
  if (groupId === targetId) {
    return rows;
  }

  const sourceRowIndex = rows.findIndex((row) => row.includes(groupId));
  const targetRowIndex = rows.findIndex((row) => row.includes(targetId));
  if (sourceRowIndex === -1 || targetRowIndex === -1) {
    return rows;
  }

  const sourceIndex = rows[sourceRowIndex].indexOf(groupId);
  const targetIndex = rows[targetRowIndex].indexOf(targetId);
  if (
    sourceRowIndex === targetRowIndex
    && ((placement === 'before' && sourceIndex === targetIndex - 1)
      || (placement === 'after' && sourceIndex === targetIndex + 1))
  ) {
    return rows;
  }

  const next = cloneToolbarRows(rows);
  const [group] = next[sourceRowIndex].splice(sourceIndex, 1);
  const nextTargetIndex = next[targetRowIndex].indexOf(targetId);
  if (nextTargetIndex === -1) {
    return rows;
  }
  next[targetRowIndex].splice(placement === 'after' ? nextTargetIndex + 1 : nextTargetIndex, 0, group);
  return next;
}

function moveToolbarGroupToRowEnd(rows: ToolbarRows, groupId: ToolbarGroupId, rowIndex: number): ToolbarRows {
  const sourceRowIndex = rows.findIndex((row) => row.includes(groupId));
  const targetRow = rows[rowIndex];
  if (sourceRowIndex === -1 || !targetRow) {
    return rows;
  }
  if (sourceRowIndex === rowIndex && targetRow[targetRow.length - 1] === groupId) {
    return rows;
  }

  const next = cloneToolbarRows(rows);
  const [group] = next[sourceRowIndex].splice(next[sourceRowIndex].indexOf(groupId), 1);
  next[rowIndex].push(group);
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

function getDistanceToRectY(rect: DOMRect, clientY: number): number {
  if (clientY < rect.top) {
    return rect.top - clientY;
  }
  if (clientY > rect.bottom) {
    return clientY - rect.bottom;
  }
  return 0;
}

function findToolbarRowDropTarget(
  row: HTMLElement,
  clientX: number,
  clientY: number,
  draggedId: ToolbarGroupId,
): ToolbarDropTarget | null {
  const rowIndex = Number(row.dataset.toolbarRowIndex ?? NaN);
  if (!Number.isFinite(rowIndex)) {
    return null;
  }

  const groups = Array.from(row.querySelectorAll<HTMLElement>('.rton-toolbar-group-shell')).filter(
    (group) => group.dataset.toolbarGroupId !== draggedId,
  );
  if (groups.length === 0) {
    return { type: 'row-end', rowIndex };
  }

  const nearestLineDistance = Math.min(...groups.map((group) => getDistanceToRectY(group.getBoundingClientRect(), clientY)));
  const lineGroups = groups
    .filter((group) => getDistanceToRectY(group.getBoundingClientRect(), clientY) <= nearestLineDistance + 2)
    .sort((left, right) => left.getBoundingClientRect().left - right.getBoundingClientRect().left);

  for (const group of lineGroups) {
    const groupId = group.dataset.toolbarGroupId;
    if (!groupId || !isToolbarGroupId(groupId)) {
      continue;
    }

    const rect = group.getBoundingClientRect();
    if (clientX < rect.left + rect.width / 2) {
      return { type: 'group', id: groupId, placement: 'before' };
    }
  }

  const lastGroupId = lineGroups[lineGroups.length - 1]?.dataset.toolbarGroupId;
  if (!lastGroupId || !isToolbarGroupId(lastGroupId)) {
    return { type: 'row-end', rowIndex };
  }
  return { type: 'group', id: lastGroupId, placement: 'after' };
}

function classNames(...values: Array<string | false | null | undefined>) {
  return values.filter(Boolean).join(' ');
}
