import type { StatusState } from '../../domain/rton-codec';
import { cx } from '../../utils/ui-classes';

export function AppStatusBar({
  displayFileName,
  outputLabel,
  outputText,
  status,
}: {
  displayFileName: string;
  outputLabel: string;
  outputText: string;
  status: StatusState;
}) {
  return (
    <footer className="flex min-h-[30px] shrink-0 items-center gap-[14px] overflow-hidden border-t border-[var(--color-border)] bg-[var(--color-status)] px-2.5 py-[5px] text-xs text-[var(--color-status-text)]">
      <span className={cx('min-w-0 flex-1 truncate', status.tone === 'error' && 'text-[var(--color-error)]', status.tone === 'ok' && 'text-[var(--color-accent-text)]')}>
        {status.message}
      </span>
      <span className="hidden shrink-0 tabular-nums text-[var(--color-text-muted)] sm:inline">{displayFileName}</span>
      <span className="hidden shrink-0 tabular-nums text-[var(--color-text-muted)] sm:inline">{outputLabel} {outputText}</span>
      <a
        href="https://space.bilibili.com/8217621"
        target="_blank"
        rel="noopener noreferrer"
        className="shrink-0 text-[var(--color-status-link)] no-underline hover:text-[var(--color-accent-text)] hover:underline"
      >
        by LambdaEd1th
      </a>
    </footer>
  );
}
