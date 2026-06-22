const buttonBase =
  'inline-flex h-7 min-w-0 shrink-0 items-center justify-center gap-1 whitespace-nowrap rounded border px-2.5 text-[13px] leading-none transition-colors focus-visible:outline-none disabled:cursor-not-allowed disabled:opacity-45';

export function cx(...classes: Array<string | false | null | undefined>) {
  return classes.filter(Boolean).join(' ');
}

export function buttonClass(variant: 'primary' | 'secondary', icon = false) {
  return cx(
    buttonBase,
    variant === 'primary' && 'border-[var(--color-accent-border)] bg-[var(--color-accent)] font-semibold text-[var(--color-accent-contrast)] hover:bg-[var(--color-accent-strong)]',
    variant === 'secondary' && 'border-[var(--color-border-strong)] bg-[var(--color-control)] text-[var(--color-text-strong)] hover:border-[var(--color-border-stronger)] hover:bg-[var(--color-control-hover)]',
    icon && 'w-7 px-0',
    '[&>svg]:h-4 [&>svg]:w-4',
  );
}

export function modeButtonClass(active: boolean) {
  return cx(
    'inline-flex h-7 min-w-14 items-center justify-center rounded border px-2 text-[13px] font-semibold leading-none transition-colors disabled:cursor-not-allowed disabled:opacity-45 focus-visible:outline-none',
    active
      ? 'border-[var(--color-accent-border)] bg-[var(--color-control-active)] text-[var(--color-accent-text)]'
      : 'border-[var(--color-border-strong)] bg-[var(--color-control)] text-[var(--color-text)] hover:bg-[var(--color-control-hover)]',
  );
}
