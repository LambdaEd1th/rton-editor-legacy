import {
  useEffect,
  useState,
  type CSSProperties,
  type KeyboardEvent as ReactKeyboardEvent,
  type MouseEvent as ReactMouseEvent,
} from 'react';
import { useI18n } from '../../localization/use-i18n';
import type { RtonValue } from '../../domain/rton-value';
import {
  convertRtonValueKind,
  rtonScalarEditText,
  rtonScalarPreview,
  rtonValueClass,
  type RtonValuePath,
  type SearchState,
  updateRtonScalarText,
} from '../../domain/rton-value-editing';
import { RtonInlineSelect } from './RtonInlineSelect';

const VALUE_TREE_CHILD_LIMIT = 160;

const RTON_VALUE_KINDS: RtonValue['kind'][] = [
  'null',
  'bool',
  'i8',
  'u8',
  'i16',
  'u16',
  'i32',
  'u32',
  'i64',
  'u64',
  'var-i32',
  'var-u32',
  'var-i64',
  'var-u64',
  'f32',
  'f64',
  'string',
  'binary',
  'rtid',
  'array',
  'object',
];
const RTON_VALUE_KIND_OPTIONS = RTON_VALUE_KINDS.map((kind) => ({ value: kind, label: kind }));

export function RtonValueInspector({
  state,
  value,
  searchMatchLimit,
  onChange,
  onNavigate,
  onError,
}: {
  state: SearchState;
  value: RtonValue | null;
  searchMatchLimit: number;
  onChange: (path: RtonValuePath, value: RtonValue) => void;
  onNavigate: (path: RtonValuePath) => void;
  onError: (message: string) => void;
}) {
  const { t } = useI18n();
  if (state.kind === 'message') {
    return <div className="rounded border border-[var(--color-border-strong)] bg-[var(--color-surface-soft)] p-3 text-[var(--color-warning)]">{state.message}</div>;
  }

  if (state.kind === 'results') {
    if (state.matches.length === 0) {
      return (
        <div className="rounded border border-[var(--color-border-strong)] bg-[var(--color-surface-soft)] p-3 text-[var(--color-warning)]">
          {state.done ? t('inspector.noMatches') : t('inspector.searchingScanned', { count: state.scanned.toLocaleString() })}
        </div>
      );
    }

    const summary = state.capped
      ? t('inspector.capped', { limit: searchMatchLimit.toLocaleString() })
      : state.done
        ? t('inspector.doneSummary', { matches: state.matches.length.toLocaleString(), scanned: state.scanned.toLocaleString() })
        : t('inspector.searchingSummary', { matches: state.matches.length.toLocaleString() });

    return (
      <div className="grid gap-1">
        <div className="sticky top-0 z-10 mb-1 rounded border border-[var(--color-border)] bg-[var(--color-surface)] p-2 text-[var(--color-text-muted)]">
          {summary} · {state.query}
        </div>
        {state.matches.map((match) => (
          <div key={`${match.path}:${match.preview}`} className="rton-search-result-row" onClick={() => onNavigate(match.valuePath)}>
            <button
              type="button"
              className="rton-search-result-path"
              onClick={(event) => {
                event.stopPropagation();
                onNavigate(match.valuePath);
              }}
            >
              {match.path}
            </button>
            <span className="rton-search-result-preview">{match.preview}</span>
          </div>
        ))}
      </div>
    );
  }

  if (!value) {
    return <div className="rounded border border-[var(--color-border-strong)] bg-[var(--color-surface-soft)] p-3 text-[var(--color-warning)]">{t('inspector.noValue')}</div>;
  }

  return <RtonValueTreeNode label="$" value={value} path={[]} depth={0} onChange={onChange} onNavigate={onNavigate} onError={onError} />;
}

function RtonValueTreeNode({
  label,
  value,
  path,
  depth,
  onChange,
  onNavigate,
  onError,
}: {
  label: string;
  value: RtonValue;
  path: RtonValuePath;
  depth: number;
  onChange: (path: RtonValuePath, value: RtonValue) => void;
  onNavigate: (path: RtonValuePath) => void;
  onError: (message: string) => void;
}) {
  const [open, setOpen] = useState(depth === 0);
  const navigate = (event: ReactMouseEvent<HTMLElement> | ReactKeyboardEvent<HTMLElement>) => {
    event.preventDefault();
    event.stopPropagation();
    onNavigate(path);
  };
  const navigateOnKeyDown = (event: ReactKeyboardEvent<HTMLElement>) => {
    if (event.key === 'Enter' || event.key === ' ') {
      navigate(event);
    }
  };
  const navigateFromRow = (event: ReactMouseEvent<HTMLElement>) => {
    if ((event.target as HTMLElement).closest('.rton-inline-select-control, input, button')) {
      return;
    }
    onNavigate(path);
  };

  if (value.kind === 'array') {
    return (
      <details open={open} onToggle={(event) => setOpen(event.currentTarget.open)} className="my-0.5">
        <summary className="cursor-pointer rounded px-1 py-1 hover:bg-[var(--color-control-hover)]" onClick={navigateFromRow}>
          <span
            role="button"
            tabIndex={0}
            className="cursor-pointer text-[var(--color-accent-text)] hover:underline focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-[var(--color-focus)]"
            onClick={navigate}
            onKeyDown={navigateOnKeyDown}
          >
            {label}
          </span>
          <span className="ml-2 text-[var(--color-text-muted)]">array · {value.items.length}</span>
          <RtonValueKindSelect value={value} path={path} onChange={onChange} onError={onError} className="ml-2" />
        </summary>
        {open && (
          <RtonValueTreeChildren
            entries={value.items.map((item, index) => ({
              key: `[${index}]`,
              value: item,
              path: [...path, { kind: 'array' as const, index }],
            }))}
            depth={depth + 1}
            onChange={onChange}
            onNavigate={onNavigate}
            onError={onError}
          />
        )}
      </details>
    );
  }

  if (value.kind === 'object') {
    return (
      <details open={open} onToggle={(event) => setOpen(event.currentTarget.open)} className="my-0.5">
        <summary className="cursor-pointer rounded px-1 py-1 hover:bg-[var(--color-control-hover)]" onClick={navigateFromRow}>
          <span
            role="button"
            tabIndex={0}
            className="cursor-pointer text-[var(--color-accent-text)] hover:underline focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-[var(--color-focus)]"
            onClick={navigate}
            onKeyDown={navigateOnKeyDown}
          >
            {label}
          </span>
          <span className="ml-2 text-[var(--color-text-muted)]">object · {value.entries.length}</span>
          <RtonValueKindSelect value={value} path={path} onChange={onChange} onError={onError} className="ml-2" />
        </summary>
        {open && (
          <RtonValueTreeChildren
            entries={value.entries.map((entry, index) => ({
              key: entry.key,
              value: entry.value,
              path: [...path, { kind: 'object' as const, index }],
            }))}
            depth={depth + 1}
            onChange={onChange}
            onNavigate={onNavigate}
            onError={onError}
          />
        )}
      </details>
    );
  }

  return (
    <div className="rton-value-scalar-row" onClick={() => onNavigate(path)}>
      <button
        type="button"
        className="rton-value-node-link"
        onClick={(event) => {
          event.stopPropagation();
          onNavigate(path);
        }}
      >
        {label}
      </button>
      <div className="rton-value-kind-cell">
        <RtonValueKindSelect value={value} path={path} onChange={onChange} onError={onError} />
      </div>
      <div className="rton-value-editor-cell">
        <RtonScalarEditor value={value} path={path} onChange={onChange} onError={onError} />
      </div>
    </div>
  );
}

function RtonValueTreeChildren({
  entries,
  depth,
  onChange,
  onNavigate,
  onError,
}: {
  entries: ReadonlyArray<{ key: string; value: RtonValue; path: RtonValuePath }>;
  depth: number;
  onChange: (path: RtonValuePath, value: RtonValue) => void;
  onNavigate: (path: RtonValuePath) => void;
  onError: (message: string) => void;
}) {
  const { t } = useI18n();
  const shown = entries.slice(0, VALUE_TREE_CHILD_LIMIT);

  return (
    <div className="rton-value-tree-children" style={{ '--rton-value-depth': depth } as CSSProperties}>
      {shown.map((entry, index) => (
        <RtonValueTreeNode
          key={`${entry.key}:${index}`}
          label={entry.key}
          value={entry.value}
          path={entry.path}
          depth={depth}
          onChange={onChange}
          onNavigate={onNavigate}
          onError={onError}
        />
      ))}
      {entries.length > shown.length && (
        <div className="my-1 rounded border border-[var(--color-border)] bg-[var(--color-surface-soft)] p-2 text-[var(--color-text-muted)]">
          {t('inspector.truncated', { shown: shown.length.toLocaleString(), total: entries.length.toLocaleString() })}
        </div>
      )}
    </div>
  );
}

function RtonValueKindSelect({
  value,
  path,
  onChange,
  onError,
  className,
}: {
  value: RtonValue;
  path: RtonValuePath;
  onChange: (path: RtonValuePath, value: RtonValue) => void;
  onError: (message: string) => void;
  className?: string;
}) {
  const { t } = useI18n();
  return (
    <RtonInlineSelect
      value={value.kind}
      options={RTON_VALUE_KIND_OPTIONS}
      ariaLabel={t('inspector.chooseValueType')}
      className={cx('rton-inline-select-kind', className)}
      onChange={(nextKind) => {
        try {
          onChange(path, convertRtonValueKind(value, nextKind));
        } catch (error) {
          onError(errorMessage(error));
        }
      }}
    />
  );
}

function RtonScalarEditor({
  value,
  path,
  onChange,
  onError,
}: {
  value: RtonValue;
  path: RtonValuePath;
  onChange: (path: RtonValuePath, value: RtonValue) => void;
  onError: (message: string) => void;
}) {
  const { t } = useI18n();
  const [text, setText] = useState(() => rtonScalarEditText(value));

  useEffect(() => {
    setText(rtonScalarEditText(value));
  }, [value]);

  if (value.kind === 'null') {
    return <span className="text-[var(--color-text-muted)]">null</span>;
  }

  if (value.kind === 'bool') {
    return (
      <RtonInlineSelect
        value={String(value.value)}
        options={[
          { value: 'true', label: 'true' },
          { value: 'false', label: 'false' },
        ]}
        ariaLabel={t('inspector.chooseBool')}
        className="rton-inline-select-bool"
        onChange={(nextValue) => onChange(path, { kind: 'bool', value: nextValue === 'true' })}
      />
    );
  }

  const commit = () => {
    try {
      const nextValue = updateRtonScalarText(value, text);
      onChange(path, nextValue);
    } catch (error) {
      onError(errorMessage(error));
      setText(rtonScalarEditText(value));
    }
  };

  return (
    <input
      value={text}
      title={rtonScalarPreview(value)}
      className={cx(
        'h-6 w-full min-w-0 rounded border border-transparent bg-transparent px-1 text-[11px] text-[var(--color-text-strong)] hover:border-[var(--color-border)] hover:bg-[var(--color-control)] focus:border-[var(--color-accent-border)] focus:bg-[var(--color-control)] focus-visible:outline-none',
        rtonValueClass(value),
      )}
      onChange={(event) => setText(event.currentTarget.value)}
      onMouseDown={(event) => event.stopPropagation()}
      onClick={(event) => event.stopPropagation()}
      onBlur={commit}
      onKeyDown={(event) => {
        if (event.key === 'Enter') {
          event.currentTarget.blur();
        } else if (event.key === 'Escape') {
          setText(rtonScalarEditText(value));
          event.currentTarget.blur();
        }
      }}
    />
  );
}

function errorMessage(error: unknown) {
  return error instanceof Error ? error.message : String(error);
}

function cx(...classes: Array<string | false | null | undefined>) {
  return classes.filter(Boolean).join(' ');
}
