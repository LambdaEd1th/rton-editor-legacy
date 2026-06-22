import {
  useCallback,
  useEffect,
  useId,
  useLayoutEffect,
  useRef,
  useState,
  type KeyboardEvent as ReactKeyboardEvent,
} from 'react';
import { createPortal } from 'react-dom';

export type RtonInlineSelectOption<T extends string> = { value: T; label: string };

export function RtonInlineSelect<T extends string>({
  value,
  options,
  onChange,
  ariaLabel,
  variant = 'compact',
  className,
}: {
  value: T;
  options: ReadonlyArray<RtonInlineSelectOption<T>>;
  onChange: (value: T) => void;
  ariaLabel: string;
  variant?: 'compact' | 'toolbar';
  className?: string;
}) {
  const controlRef = useRef<HTMLSpanElement | null>(null);
  const menuRef = useRef<HTMLDivElement | null>(null);
  const generatedId = useId();
  const [open, setOpen] = useState(false);
  const selected = options.find((option) => option.value === value);
  const menuId = `${generatedId}-menu`;

  const positionMenu = useCallback(() => {
    const control = controlRef.current;
    const menu = menuRef.current;
    if (!control || !menu) {
      return;
    }

    const viewportPadding = 8;
    const menuGap = 6;
    const controlRect = control.getBoundingClientRect();
    const menuMinWidth = Math.max(variant === 'toolbar' ? 138 : 112, Math.round(controlRect.width));
    menu.style.setProperty('--rton-select-menu-min-width', `${menuMinWidth}px`);
    menu.style.setProperty('--rton-select-menu-max-height', `${Math.max(96, window.innerHeight - viewportPadding * 2)}px`);
    menu.style.removeProperty('--rton-select-menu-width');

    const optionWidth = Math.max(
      menuMinWidth,
      ...Array.from(menu.querySelectorAll('button')).map((button) => button.scrollWidth + (variant === 'toolbar' ? 10 : 12)),
    );
    const menuWidth = Math.min(Math.ceil(optionWidth), window.innerWidth - viewportPadding * 2);
    menu.style.setProperty('--rton-select-menu-width', `${menuWidth}px`);

    const menuHeight = menu.getBoundingClientRect().height || 0;
    const maxLeft = window.innerWidth - viewportPadding - menuWidth;
    const left = Math.max(viewportPadding, Math.min(controlRect.left, maxLeft));
    const belowTop = controlRect.bottom + menuGap;
    const aboveTop = controlRect.top - menuGap - menuHeight;
    const hasMoreSpaceAbove = controlRect.top - viewportPadding > window.innerHeight - controlRect.bottom - viewportPadding;
    const top =
      belowTop + menuHeight <= window.innerHeight - viewportPadding || !hasMoreSpaceAbove
        ? Math.min(belowTop, window.innerHeight - viewportPadding - menuHeight)
        : aboveTop;

    menu.style.setProperty('--rton-select-menu-left', `${Math.round(left)}px`);
    menu.style.setProperty('--rton-select-menu-top', `${Math.round(Math.max(viewportPadding, top))}px`);
  }, [variant]);

  useLayoutEffect(() => {
    if (open) {
      positionMenu();
    }
  }, [open, options, positionMenu, value]);

  useEffect(() => {
    if (!open) {
      return;
    }

    const closeOnOutsidePointer = (event: PointerEvent) => {
      const target = event.target as Node;
      if (controlRef.current?.contains(target) || menuRef.current?.contains(target)) {
        return;
      }
      setOpen(false);
    };
    const reposition = () => positionMenu();

    document.addEventListener('pointerdown', closeOnOutsidePointer);
    window.addEventListener('resize', reposition);
    window.addEventListener('scroll', reposition, true);
    return () => {
      document.removeEventListener('pointerdown', closeOnOutsidePointer);
      window.removeEventListener('resize', reposition);
      window.removeEventListener('scroll', reposition, true);
    };
  }, [open, positionMenu]);

  const selectOption = useCallback(
    (nextValue: T) => {
      setOpen(false);
      onChange(nextValue);
      requestAnimationFrame(() => controlRef.current?.focus());
    },
    [onChange],
  );

  const handleKeyDown = (event: ReactKeyboardEvent<HTMLSpanElement>) => {
    if (event.key === 'Enter' || event.key === ' ' || event.key === 'ArrowDown') {
      event.preventDefault();
      setOpen(true);
    } else if (event.key === 'Escape') {
      setOpen(false);
    }
  };

  return (
    <>
      <span
        ref={controlRef}
        className={cx('rton-inline-select-control', variant === 'toolbar' && 'rton-inline-select-toolbar', open && 'is-open', className)}
        role="button"
        aria-label={ariaLabel}
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-controls={open ? menuId : undefined}
        tabIndex={0}
        onClick={(event) => {
          event.preventDefault();
          event.stopPropagation();
          setOpen((current) => !current);
        }}
        onMouseDown={(event) => event.stopPropagation()}
        onKeyDown={handleKeyDown}
      >
        <span className="rton-inline-select-value" title={selected?.label}>
          {selected?.label ?? value}
        </span>
        <span className="rton-inline-select-caret">▾</span>
      </span>
      {open &&
        createPortal(
          <div
            ref={menuRef}
            id={menuId}
            className={cx('rton-inline-select-menu', variant === 'toolbar' && 'rton-inline-select-menu-toolbar')}
            role="listbox"
            aria-label={ariaLabel}
            onPointerDown={(event) => event.stopPropagation()}
          >
            {options.map((option) => (
              <button
                key={option.value}
                type="button"
                className={cx(option.value === value && 'active')}
                role="option"
                aria-selected={option.value === value}
                title={option.label}
                onClick={(event) => {
                  event.stopPropagation();
                  selectOption(option.value);
                }}
              >
                {option.label}
              </button>
            ))}
          </div>,
          document.body,
        )}
    </>
  );
}

function cx(...classes: Array<string | false | null | undefined>) {
  return classes.filter(Boolean).join(' ');
}
