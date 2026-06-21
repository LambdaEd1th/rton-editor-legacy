import { useEffect, useRef, useState, type PointerEvent as ReactPointerEvent, type ReactNode } from 'react';
import { useI18n } from '../localization/use-i18n';

export type PanelSide = 'left' | 'right';

export function PanelHeader({
  icon,
  title,
  subtitle,
  actions,
  below,
}: {
  icon: ReactNode;
  title: string;
  subtitle?: string;
  actions?: ReactNode;
  below?: ReactNode;
}) {
  return (
    <header className="min-h-10 shrink-0 border-b border-[var(--color-border)] bg-[var(--color-surface-raised)] px-2.5 py-2">
      <div className="flex min-w-0 items-start justify-between gap-2">
        <div className="min-w-0 flex-1">
          <div className="flex min-w-0 items-center gap-2 text-[var(--color-text-strong)]">
            <span className="shrink-0 [&>svg]:h-4 [&>svg]:w-4 [&>svg]:text-[var(--color-accent-text)]">{icon}</span>
            <h2 className="truncate text-sm font-semibold leading-none">{title}</h2>
          </div>
          {subtitle && <p className="mt-1 truncate text-xs text-[var(--color-text-muted)]">{subtitle}</p>}
        </div>
        {actions && <div className="flex shrink-0 items-center justify-end gap-1.5 whitespace-nowrap">{actions}</div>}
      </div>
      {below && <div className="mt-2">{below}</div>}
    </header>
  );
}

export function MetaItem({ label, value }: { label: string; value: string }) {
  return (
    <div className="min-w-0">
      <dt className="text-xs text-[var(--color-text-muted)]">{label}</dt>
      <dd className="mt-1 break-words text-[var(--color-text-strong)]">{value}</dd>
    </div>
  );
}

export function Stat({ label, value }: { label: string; value: number }) {
  return (
    <div className="min-w-0 rounded border border-[var(--color-border)] bg-[var(--color-surface-soft)] p-2.5">
      <span className="block text-xs text-[var(--color-text-muted)]">{label}</span>
      <strong className="mt-1 block text-xl leading-none text-[var(--color-text-strong)]">{value.toLocaleString()}</strong>
    </div>
  );
}

export function PanelResizeHandle({
  side,
  width,
  onResize,
}: {
  side: PanelSide;
  width: number;
  onResize: (side: PanelSide, width: number) => void;
}) {
  const { t } = useI18n();
  const [dragging, setDragging] = useState(false);
  const draggingRef = useRef(false);
  const startRef = useRef({ x: 0, width });

  useEffect(() => {
    if (!dragging) {
      return;
    }

    const handleMouseMove = (event: MouseEvent) => {
      if (!draggingRef.current) {
        return;
      }
      const delta = side === 'left' ? event.clientX - startRef.current.x : startRef.current.x - event.clientX;
      onResize(side, startRef.current.width + delta);
    };
    const handleMouseUp = () => {
      draggingRef.current = false;
      setDragging(false);
    };

    window.addEventListener('mousemove', handleMouseMove);
    window.addEventListener('mouseup', handleMouseUp);
    return () => {
      window.removeEventListener('mousemove', handleMouseMove);
      window.removeEventListener('mouseup', handleMouseUp);
    };
  }, [dragging, onResize, side]);

  const finishDrag = (event: ReactPointerEvent<HTMLDivElement>) => {
    if (!draggingRef.current) {
      return;
    }
    draggingRef.current = false;
    setDragging(false);
    if (event.currentTarget.hasPointerCapture(event.pointerId)) {
      event.currentTarget.releasePointerCapture(event.pointerId);
    }
  };

  return (
    <div
      className={classNames('rton-resize-handle', `rton-resize-handle-${side}`, dragging && 'dragging')}
      role="separator"
      aria-orientation="vertical"
      aria-label={side === 'left' ? t('resize.fileList') : t('resize.fileProperties')}
      onPointerDown={(event) => {
        event.preventDefault();
        startRef.current = { x: event.clientX, width };
        draggingRef.current = true;
        setDragging(true);
        event.currentTarget.setPointerCapture(event.pointerId);
      }}
      onPointerMove={(event) => {
        if (!draggingRef.current) {
          return;
        }
        const delta = side === 'left' ? event.clientX - startRef.current.x : startRef.current.x - event.clientX;
        onResize(side, startRef.current.width + delta);
      }}
      onPointerUp={finishDrag}
      onPointerCancel={finishDrag}
      onMouseDown={(event) => {
        if (draggingRef.current) {
          return;
        }
        event.preventDefault();
        startRef.current = { x: event.clientX, width };
        draggingRef.current = true;
        setDragging(true);
      }}
    />
  );
}

function classNames(...values: Array<string | false | null | undefined>) {
  return values.filter(Boolean).join(' ');
}
