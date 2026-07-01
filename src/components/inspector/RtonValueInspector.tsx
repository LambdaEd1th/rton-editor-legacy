import {
  useEffect,
  useRef,
  useState,
  type CSSProperties,
  type KeyboardEvent as ReactKeyboardEvent,
  type MouseEvent as ReactMouseEvent,
} from 'react';
import { Plus, Trash2 } from 'lucide-react';
import { useI18n } from '../../localization/use-i18n';
import type { RtonValue } from '../../domain/rton-value';
import {
  convertRtonValueKind,
  rtonScalarEditText,
  rtonScalarPreview,
  rtonValueClass,
  type RtonDocumentEditOperation,
  type RtonValuePath,
  type SearchState,
  updateRtonScalarText,
} from '../../domain/rton-value-editing';
import { RtonInlineSelect } from './RtonInlineSelect';
import type { RemoteRtonValueNode, RtonDocumentRef } from '../../domain/rton-document';
import { RTON_REMOTE_CHILD_PAGE_SIZE } from '../../domain/rton-document';
import type { RtonDocumentChildrenOutput } from '../../hooks/worker-clients';

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
  document,
  canBuildIndex = false,
  indexBuilding = false,
  searchMatchLimit,
  loadDocumentChildren,
  onBuildIndex,
  onChange,
  onNavigate,
  onRemoteEdit,
  onError,
}: {
  state: SearchState;
  value: RtonValue | null;
  document?: RtonDocumentRef | null;
  canBuildIndex?: boolean;
  indexBuilding?: boolean;
  searchMatchLimit: number;
  loadDocumentChildren?: (documentId: number, path: RtonValuePath, offset: number, limit: number) => Promise<RtonDocumentChildrenOutput>;
  onBuildIndex?: () => void;
  onChange: (path: RtonValuePath, value: RtonValue) => void;
  onNavigate: (path: RtonValuePath) => void;
  onRemoteEdit?: (operation: RtonDocumentEditOperation) => void;
  onError: (message: string) => void;
}) {
  const { t } = useI18n();
  if (state.kind === 'message') {
    return (
      <div className="grid gap-2 rounded border border-[var(--color-border-strong)] bg-[var(--color-surface-soft)] p-3 text-[var(--color-warning)]">
        <div>{state.message}</div>
        {canBuildIndex && onBuildIndex && (
          <button
            type="button"
            disabled={indexBuilding}
            className="w-fit rounded border border-[var(--color-border-strong)] bg-[var(--color-control)] px-2 py-1 text-[var(--color-text-strong)] hover:bg-[var(--color-control-hover)] disabled:cursor-wait disabled:opacity-60"
            onClick={onBuildIndex}
          >
            {indexBuilding ? t('inspector.indexBuilding') : t('inspector.buildIndex')}
          </button>
        )}
      </div>
    );
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

  if (!value && document && loadDocumentChildren) {
    return (
      <RemoteRtonValueTree
        document={document}
        loadChildren={loadDocumentChildren}
        onChange={onChange}
        onNavigate={onNavigate}
        onRemoteEdit={onRemoteEdit}
        onError={onError}
      />
    );
  }

  if (!value && canBuildIndex && onBuildIndex) {
    return (
      <div className="grid gap-2 rounded border border-[var(--color-border-strong)] bg-[var(--color-surface-soft)] p-3 text-[var(--color-warning)]">
        <div>{t('inspector.indexNotBuilt')}</div>
        <button
          type="button"
          disabled={indexBuilding}
          className="w-fit rounded border border-[var(--color-border-strong)] bg-[var(--color-control)] px-2 py-1 text-[var(--color-text-strong)] hover:bg-[var(--color-control-hover)] disabled:cursor-wait disabled:opacity-60"
          onClick={onBuildIndex}
        >
          {indexBuilding ? t('inspector.indexBuilding') : t('inspector.buildIndex')}
        </button>
      </div>
    );
  }

  if (!value) {
    return <div className="rounded border border-[var(--color-border-strong)] bg-[var(--color-surface-soft)] p-3 text-[var(--color-warning)]">{t('inspector.noValue')}</div>;
  }

  return <RtonValueTreeNode label="$" value={value} path={[]} depth={0} onChange={onChange} onNavigate={onNavigate} onError={onError} />;
}

function RemoteRtonValueTree({
  document,
  loadChildren,
  onChange,
  onNavigate,
  onRemoteEdit,
  onError,
}: {
  document: RtonDocumentRef;
  loadChildren: (documentId: number, path: RtonValuePath, offset: number, limit: number) => Promise<RtonDocumentChildrenOutput>;
  onChange: (path: RtonValuePath, value: RtonValue) => void;
  onNavigate: (path: RtonValuePath) => void;
  onRemoteEdit?: (operation: RtonDocumentEditOperation) => void;
  onError: (message: string) => void;
}) {
  return (
    <RemoteRtonValueTreeNode
      key={`${document.id}:${document.version}`}
      documentId={document.id}
      node={document.root}
      depth={0}
      loadChildren={loadChildren}
      onChange={onChange}
      onNavigate={onNavigate}
      onRemoteEdit={onRemoteEdit}
      onError={onError}
    />
  );
}

function RemoteRtonValueTreeNode({
  documentId,
  node,
  depth,
  loadChildren,
  onChange,
  onNavigate,
  onRemoteEdit,
  onError,
}: {
  documentId: number;
  node: RemoteRtonValueNode;
  depth: number;
  loadChildren: (documentId: number, path: RtonValuePath, offset: number, limit: number) => Promise<RtonDocumentChildrenOutput>;
  onChange: (path: RtonValuePath, value: RtonValue) => void;
  onNavigate: (path: RtonValuePath) => void;
  onRemoteEdit?: (operation: RtonDocumentEditOperation) => void;
  onError: (message: string) => void;
}) {
  const { t } = useI18n();
  const [open, setOpen] = useState(depth === 0);
  const [children, setChildren] = useState<RemoteRtonValueNode[]>([]);
  const [total, setTotal] = useState(node.childCount);
  const [loading, setLoading] = useState(false);
  const loadingRef = useRef(false);
  const hasChildren = node.childCount > 0;

  const requestChildren = (offset: number) => {
    if (!hasChildren || loadingRef.current) {
      return;
    }
    loadingRef.current = true;
    setLoading(true);
    loadChildren(documentId, node.path, offset, RTON_REMOTE_CHILD_PAGE_SIZE)
      .then((result) => {
        setTotal(result.total);
        setChildren((current) => (offset === 0 ? result.nodes : [...current, ...result.nodes]));
      })
      .catch((error: unknown) => onError(errorMessage(error)))
      .finally(() => {
        loadingRef.current = false;
        setLoading(false);
      });
  };

  useEffect(() => {
    if (open && hasChildren && children.length === 0 && !loading) {
      requestChildren(0);
    }
  });

  if (hasChildren) {
    return (
      <details open={open} onToggle={(event) => setOpen(event.currentTarget.open)} className="my-0.5">
        <summary className="cursor-pointer rounded px-1 py-1 hover:bg-[var(--color-control-hover)]">
          <RemoteNodeLabel node={node} onNavigate={onNavigate} />
          <RemoteNodeActions node={node} onEdit={onRemoteEdit} />
        </summary>
        {open && (
          <div className="rton-value-tree-children" style={{ '--rton-value-depth': depth + 1 } as CSSProperties}>
            {children.map((child, index) => (
              <RemoteRtonValueTreeNode
                key={`${child.label}:${index}`}
                documentId={documentId}
                node={child}
                depth={depth + 1}
                loadChildren={loadChildren}
                onChange={onChange}
                onNavigate={onNavigate}
                onRemoteEdit={onRemoteEdit}
                onError={onError}
              />
            ))}
            {loading && <div className="py-1 text-[var(--color-text-muted)]">{t('inspector.loading')}</div>}
            {!loading && children.length < total && (
              <button
                type="button"
                className="my-1 rounded border border-[var(--color-border)] bg-[var(--color-control)] px-2 py-1 text-left text-[var(--color-text-muted)] hover:bg-[var(--color-control-hover)]"
                onClick={() => requestChildren(children.length)}
              >
                {t('inspector.loadMore', {
                  shown: children.length.toLocaleString(),
                  total: total.toLocaleString(),
                })}
              </button>
            )}
          </div>
        )}
      </details>
    );
  }

  return (
    <div className="rton-value-scalar-row" onClick={() => onNavigate(node.path)}>
      <div className="rton-value-name-cell">
        <button
          type="button"
          className="rton-value-node-link"
          onClick={(event) => {
            event.stopPropagation();
            onNavigate(node.path);
          }}
        >
          {node.label}
        </button>
        <RemoteNodeActions node={node} onEdit={onRemoteEdit} />
      </div>
      {node.scalarValue ? (
        <>
          <div className="rton-value-kind-cell">
            <RtonValueKindSelect value={node.scalarValue} path={node.path} onChange={onChange} onError={onError} />
          </div>
          <div className="rton-value-editor-cell">
            <RtonScalarEditor value={node.scalarValue} path={node.path} onChange={onChange} onError={onError} />
          </div>
        </>
      ) : (
        <>
          <span className="ml-2 rounded border border-[var(--color-border)] bg-[var(--color-control)] px-2 py-0.5 text-[var(--color-text-muted)]">
            {node.kind}
          </span>
          <span className="ml-2 text-[var(--color-text-muted)]">{node.preview}</span>
        </>
      )}
    </div>
  );
}

function RemoteNodeActions({
  node,
  onEdit,
}: {
  node: RemoteRtonValueNode;
  onEdit?: (operation: RtonDocumentEditOperation) => void;
}) {
  const { t } = useI18n();
  if (!onEdit) {
    return null;
  }

  const canInsertChild = node.kind === 'array' || node.kind === 'object';
  const canDelete = node.path.length > 0;
  if (!canInsertChild && !canDelete) {
    return null;
  }

  const runAction = (event: ReactMouseEvent<HTMLButtonElement>, operation: RtonDocumentEditOperation) => {
    event.preventDefault();
    event.stopPropagation();
    onEdit(operation);
  };

  return (
    <span className="rton-value-node-actions">
      {canInsertChild && (
        <button
          type="button"
          className="rton-value-action-button"
          title={t('inspector.addChild')}
          aria-label={t('inspector.addChild')}
          onClick={(event) =>
            runAction(
              event,
              node.kind === 'array'
                ? { kind: 'insertArrayItem', path: node.path, index: node.childCount, value: { kind: 'null' } }
                : { kind: 'insertObjectEntry', path: node.path, index: node.childCount, key: 'new_key', value: { kind: 'null' } },
            )
          }
        >
          <Plus className="h-3 w-3" />
        </button>
      )}
      {canDelete && (
        <button
          type="button"
          className="rton-value-action-button"
          title={t('inspector.deleteNode')}
          aria-label={t('inspector.deleteNode')}
          onClick={(event) => runAction(event, { kind: 'deleteValue', path: node.path })}
        >
          <Trash2 className="h-3 w-3" />
        </button>
      )}
    </span>
  );
}

function RemoteNodeLabel({
  node,
  onNavigate,
}: {
  node: RemoteRtonValueNode;
  onNavigate: (path: RtonValuePath) => void;
}) {
  return (
    <>
      <button
        type="button"
        className="rton-value-node-link"
        onClick={(event) => {
          event.stopPropagation();
          onNavigate(node.path);
        }}
      >
        {node.label}
      </button>
      <span className="ml-2 rounded border border-[var(--color-border)] bg-[var(--color-control)] px-2 py-0.5 text-[var(--color-text-muted)]">
        {node.kind}
      </span>
      <span className="ml-2 text-[var(--color-text-muted)]">{node.preview}</span>
    </>
  );
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
    const shownItems = value.items.slice(0, VALUE_TREE_CHILD_LIMIT);
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
            entries={shownItems.map((item, index) => ({
              key: `[${index}]`,
              value: item,
              path: [...path, { kind: 'array' as const, index }],
            }))}
            totalCount={value.items.length}
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
    const shownEntries = value.entries.slice(0, VALUE_TREE_CHILD_LIMIT);
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
            entries={shownEntries.map((entry, index) => ({
              key: entry.key,
              value: entry.value,
              path: [...path, { kind: 'object' as const, index }],
            }))}
            totalCount={value.entries.length}
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
  totalCount,
  depth,
  onChange,
  onNavigate,
  onError,
}: {
  entries: ReadonlyArray<{ key: string; value: RtonValue; path: RtonValuePath }>;
  totalCount: number;
  depth: number;
  onChange: (path: RtonValuePath, value: RtonValue) => void;
  onNavigate: (path: RtonValuePath) => void;
  onError: (message: string) => void;
}) {
  const { t } = useI18n();

  return (
    <div className="rton-value-tree-children" style={{ '--rton-value-depth': depth } as CSSProperties}>
      {entries.map((entry, index) => (
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
      {totalCount > entries.length && (
        <div className="my-1 rounded border border-[var(--color-border)] bg-[var(--color-surface-soft)] p-2 text-[var(--color-text-muted)]">
          {t('inspector.truncated', { shown: entries.length.toLocaleString(), total: totalCount.toLocaleString() })}
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
