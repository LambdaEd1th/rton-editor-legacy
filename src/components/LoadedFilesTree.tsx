import { useEffect, useMemo, useRef, useState } from 'react';
import { useI18n } from '../localization/use-i18n';

export type LoadedFileTreeItem = {
  key: string;
  fileId: number | null;
  tabId: number | null;
  path: string;
  name: string;
  detail: string;
  active: boolean;
};

type LoadedFileTreeNode =
  | { kind: 'folder'; name: string; path: string; count: number; children: LoadedFileTreeNode[] }
  | { kind: 'file'; name: string; item: LoadedFileTreeItem };

export function LoadedFilesTree({
  items,
  selectedKeys,
  emptyMessage,
  forceOpenFolders,
  onOpenFile,
  onActivate,
  onClose,
  onToggleSelected,
  onToggleSelectedMany,
}: {
  items: LoadedFileTreeItem[];
  selectedKeys: Set<string>;
  emptyMessage: string;
  forceOpenFolders: boolean;
  onOpenFile: (fileId: number) => void;
  onActivate: (tabId: number) => void;
  onClose: (tabId: number) => void;
  onToggleSelected: (key: string, selected: boolean) => void;
  onToggleSelectedMany: (keys: string[], selected: boolean) => void;
}) {
  const { t } = useI18n();
  const nodes = useMemo(() => buildLoadedFileTree(items), [items]);

  return (
    <div role="tree" aria-label={t('fileList.loadedFiles')} className="grid gap-1">
      {nodes.length === 0 ? (
        <div className="rounded border border-[var(--color-border)] bg-[var(--color-surface-soft)] p-3 text-xs text-[var(--color-text-muted)]">
          {emptyMessage}
        </div>
      ) : (
        nodes.map((node) => (
          <LoadedFileTreeNodeView
            key={node.kind === 'folder' ? `folder:${node.path}` : node.item.key}
            node={node}
            canClose={Boolean(node.kind === 'file' && node.item.tabId)}
            onOpenFile={onOpenFile}
            onActivate={onActivate}
            onClose={onClose}
            forceOpenFolders={forceOpenFolders}
            selectedKeys={selectedKeys}
            onToggleSelected={onToggleSelected}
            onToggleSelectedMany={onToggleSelectedMany}
          />
        ))
      )}
    </div>
  );
}

function LoadedFileTreeNodeView({
  node,
  canClose,
  onOpenFile,
  onActivate,
  onClose,
  forceOpenFolders,
  selectedKeys,
  onToggleSelected,
  onToggleSelectedMany,
}: {
  node: LoadedFileTreeNode;
  canClose: boolean;
  onOpenFile: (fileId: number) => void;
  onActivate: (tabId: number) => void;
  onClose: (tabId: number) => void;
  forceOpenFolders: boolean;
  selectedKeys: Set<string>;
  onToggleSelected: (key: string, selected: boolean) => void;
  onToggleSelectedMany: (keys: string[], selected: boolean) => void;
}) {
  const { t } = useI18n();
  if (node.kind === 'folder') {
    return (
      <LoadedFolderTreeNodeView
        node={node}
        onOpenFile={onOpenFile}
        onActivate={onActivate}
        onClose={onClose}
        forceOpenFolders={forceOpenFolders}
        selectedKeys={selectedKeys}
        onToggleSelected={onToggleSelected}
        onToggleSelectedMany={onToggleSelectedMany}
      />
    );
  }

  const { item } = node;
  const closeTabId = item.tabId;
  return (
    <div role="treeitem" aria-selected={item.active} className={fileListItemClass(item.active)}>
      <label className="grid h-full w-8 shrink-0 place-items-center text-[var(--color-text-muted)]">
        <input
          type="checkbox"
          checked={selectedKeys.has(item.key)}
          aria-label={t('fileList.selectPath', { path: item.path })}
          className="h-4 w-4 accent-[var(--color-accent)]"
          onChange={(event) => onToggleSelected(item.key, event.currentTarget.checked)}
          onClick={(event) => event.stopPropagation()}
        />
      </label>
      <button
        type="button"
        title={item.path}
        className="min-w-0 flex-1 border-0 bg-transparent px-2.5 py-2 text-left text-inherit focus-visible:outline-none"
        onClick={() => {
          if (item.tabId !== null) {
            onActivate(item.tabId);
          } else if (item.fileId !== null) {
            void onOpenFile(item.fileId);
          }
        }}
      >
        <span className="block overflow-hidden text-ellipsis whitespace-nowrap font-mono text-[12px] text-[var(--color-text-strong)]">
          {item.name}
        </span>
        <span className="mt-1 block overflow-hidden text-ellipsis whitespace-nowrap text-xs text-[var(--color-text-muted)]">
          {item.detail}
        </span>
      </button>
      {canClose && closeTabId !== null && (
        <button
          type="button"
          title={t('tabs.close')}
          aria-label={t('tabs.close')}
          className="mr-1 grid h-6 w-6 shrink-0 place-items-center rounded border-0 bg-transparent text-[var(--color-text-muted)] hover:bg-[var(--color-border)] hover:text-[var(--color-text-strong)] focus-visible:outline-none"
          onClick={(event) => {
            event.stopPropagation();
            onClose(closeTabId);
          }}
        >
          &times;
        </button>
      )}
    </div>
  );
}

function LoadedFolderTreeNodeView({
  node,
  onOpenFile,
  onActivate,
  onClose,
  forceOpenFolders,
  selectedKeys,
  onToggleSelected,
  onToggleSelectedMany,
}: {
  node: LoadedFileTreeNode & { kind: 'folder' };
  onOpenFile: (fileId: number) => void;
  onActivate: (tabId: number) => void;
  onClose: (tabId: number) => void;
  forceOpenFolders: boolean;
  selectedKeys: Set<string>;
  onToggleSelected: (key: string, selected: boolean) => void;
  onToggleSelectedMany: (keys: string[], selected: boolean) => void;
}) {
  const { t } = useI18n();
  const [open, setOpen] = useState(false);
  const checkboxRef = useRef<HTMLInputElement | null>(null);
  const fileKeys = useMemo(() => collectLoadedFileKeys(node), [node]);
  const selectedCount = fileKeys.reduce((count, key) => count + (selectedKeys.has(key) ? 1 : 0), 0);
  const checked = fileKeys.length > 0 && selectedCount === fileKeys.length;
  const indeterminate = selectedCount > 0 && selectedCount < fileKeys.length;
  const detailsOpen = forceOpenFolders || open;

  useEffect(() => {
    if (checkboxRef.current) {
      checkboxRef.current.indeterminate = indeterminate;
    }
  }, [indeterminate]);

  return (
    <details open={detailsOpen} onToggle={(event) => {
      if (!forceOpenFolders) {
        setOpen(event.currentTarget.open);
      }
    }} className="min-w-0">
      <summary
        role="treeitem"
        aria-label={node.path}
        className="rton-file-tree-summary cursor-pointer rounded px-2 py-1.5 text-xs font-semibold text-[var(--color-text-muted)] hover:bg-[var(--color-control-hover)]"
      >
        <span className="rton-file-tree-summary-content">
          <label className="grid h-4 w-4 shrink-0 place-items-center text-[var(--color-text-muted)]" onClick={(event) => event.stopPropagation()}>
            <input
              ref={checkboxRef}
              type="checkbox"
              checked={checked}
              aria-label={t('fileList.selectPath', { path: node.path })}
              className="h-4 w-4 accent-[var(--color-accent)]"
              onChange={(event) => onToggleSelectedMany(fileKeys, event.currentTarget.checked)}
              onClick={(event) => event.stopPropagation()}
            />
          </label>
          <span className="min-w-0 overflow-hidden text-ellipsis whitespace-nowrap font-mono">{node.name}</span>
          <span className="min-w-0 overflow-hidden text-ellipsis whitespace-nowrap font-normal tabular-nums text-[var(--color-text-subtle)]">
            {t('fileList.fileCount', { count: node.count.toLocaleString() })}
          </span>
        </span>
      </summary>
      {detailsOpen && (
        <div role="group" className="ml-3 grid gap-1 border-l border-[var(--color-border)] pl-2">
          {node.children.map((child) => (
            <LoadedFileTreeNodeView
              key={child.kind === 'folder' ? `folder:${child.path}` : child.item.key}
              node={child}
              canClose={Boolean(child.kind === 'file' && child.item.tabId)}
              onOpenFile={onOpenFile}
              onActivate={onActivate}
              onClose={onClose}
              forceOpenFolders={forceOpenFolders}
              selectedKeys={selectedKeys}
              onToggleSelected={onToggleSelected}
              onToggleSelectedMany={onToggleSelectedMany}
            />
          ))}
        </div>
      )}
    </details>
  );
}

function buildLoadedFileTree(items: LoadedFileTreeItem[]): LoadedFileTreeNode[] {
  const root: LoadedFileTreeNode & { kind: 'folder' } = { kind: 'folder', name: '', path: '', count: 0, children: [] };
  const folders = new Map<string, LoadedFileTreeNode & { kind: 'folder' }>([['', root]]);

  for (const item of items) {
    const parts = splitDisplayPath(item.path);
    const fileName = parts.pop() ?? item.name;
    let parent = root;
    let parentPath = '';
    root.count += 1;

    for (const part of parts) {
      const folderPath = parentPath ? `${parentPath}/${part}` : part;
      let folder = folders.get(folderPath);
      if (!folder) {
        folder = { kind: 'folder', name: part, path: folderPath, count: 0, children: [] };
        folders.set(folderPath, folder);
        parent.children.push(folder);
      }
      folder.count += 1;
      parent = folder;
      parentPath = folderPath;
    }

    parent.children.push({ kind: 'file', name: fileName, item: { ...item, name: fileName } });
  }

  sortLoadedFileTree(root.children);
  return root.children;
}

function sortLoadedFileTree(nodes: LoadedFileTreeNode[]) {
  nodes.sort((left, right) => {
    if (left.kind !== right.kind) {
      return left.kind === 'folder' ? -1 : 1;
    }
    return left.name.localeCompare(right.name, undefined, { numeric: true, sensitivity: 'base' });
  });

  for (const node of nodes) {
    if (node.kind === 'folder') {
      sortLoadedFileTree(node.children);
    }
  }
}

function collectLoadedFileKeys(node: LoadedFileTreeNode): string[] {
  if (node.kind === 'file') {
    return [node.item.key];
  }

  return node.children.flatMap(collectLoadedFileKeys);
}

function splitDisplayPath(path: string) {
  return path.replace(/\\/g, '/').replace(/^\/+/, '').split('/').filter(Boolean);
}

function fileListItemClass(active: boolean) {
  return cx(
    'flex min-w-0 items-center overflow-hidden rounded border transition-colors',
    active
      ? 'border-[var(--color-accent-border)] bg-[var(--color-control-active)] text-[var(--color-text-strong)]'
      : 'border-[var(--color-border)] bg-[var(--color-surface-soft)] text-[var(--color-text)] hover:border-[var(--color-border-strong)] hover:bg-[var(--color-control-hover)]',
  );
}

function cx(...classes: Array<string | false | null | undefined>) {
  return classes.filter(Boolean).join(' ');
}
