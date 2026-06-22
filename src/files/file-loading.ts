export type LoadableFileKind = 'rton' | 'json' | 'yaml' | 'toml';

export type RtonLoadEntry = {
  file: File;
  path: string;
};

export type LoadableFileCandidate = RtonLoadEntry & {
  kind: LoadableFileKind;
};

export type DroppedRtonEntries = {
  entries: RtonLoadEntry[];
  containsDirectory: boolean;
};

export type DirectoryPickerWindow = Window & {
  showDirectoryPicker?: () => Promise<FileSystemDirectoryHandle>;
};

export const LOADABLE_FILE_ACCEPT =
  '.rton,.dat,.json,.yaml,.yml,.toml,application/octet-stream,application/json,application/yaml,text/yaml,application/toml,text/toml,text/plain';
export const LOADABLE_FILE_HINT = '.rton / .dat / .json / .yaml / .yml / .toml';

export function collectLoadableCandidates(entries: RtonLoadEntry[], allowSingleFallback: boolean): LoadableFileCandidate[] {
  const allowFallback = allowSingleFallback && entries.length === 1;
  return entries.flatMap((entry) => {
    const kind = detectLoadableFileKind(entry.file, allowFallback);
    return kind ? [{ ...entry, kind }] : [];
  });
}

export async function collectDirectoryEntries(
  directoryHandle: FileSystemDirectoryHandle,
  parentPath = '',
): Promise<RtonLoadEntry[]> {
  const entries: RtonLoadEntry[] = [];
  for await (const [name, child] of directoryHandle.entries()) {
    const path = parentPath ? `${parentPath}/${name}` : name;
    if (child.kind === 'file') {
      entries.push({ file: await child.getFile(), path });
    } else {
      entries.push(...await collectDirectoryEntries(child, path));
    }
  }
  return entries;
}

export async function collectDroppedEntries(dataTransfer: DataTransfer): Promise<DroppedRtonEntries> {
  const rootEntries = Array.from(dataTransfer.items)
    .filter((item) => item.kind === 'file')
    .map((item) => item.webkitGetAsEntry())
    .filter((entry): entry is FileSystemEntry => Boolean(entry));

  if (rootEntries.length > 0) {
    const nested = await Promise.all(rootEntries.map((entry) => collectFileSystemEntry(entry)));
    return {
      entries: nested.flat(),
      containsDirectory: rootEntries.some((entry) => entry.isDirectory),
    };
  }

  return {
    entries: Array.from(dataTransfer.files).map((file) => ({ file, path: displayFilePath(file) })),
    containsDirectory: false,
  };
}

export function displayFilePath(file: File) {
  return normalizeDisplayPath(file.webkitRelativePath || file.name) || file.name;
}

export function normalizeDisplayPath(path: string) {
  return path.replace(/\\/g, '/').replace(/^\/+/, '');
}

export function splitDisplayPath(path: string) {
  return normalizeDisplayPath(path).split('/').filter(Boolean);
}

export function loadableFileKindLabel(kind: LoadableFileKind) {
  return kind.toUpperCase();
}

function detectLoadableFileKind(file: File, allowFallback: boolean): LoadableFileKind | null {
  if (/\.(?:rton|dat)$/i.test(file.name)) {
    return 'rton';
  }
  if (/\.json$/i.test(file.name)) {
    return 'json';
  }
  if (/\.ya?ml$/i.test(file.name)) {
    return 'yaml';
  }
  if (/\.toml$/i.test(file.name)) {
    return 'toml';
  }
  return allowFallback ? 'rton' : null;
}

async function collectFileSystemEntry(entry: FileSystemEntry, parentPath = ''): Promise<RtonLoadEntry[]> {
  const path = parentPath ? `${parentPath}/${entry.name}` : entry.name;
  if (entry.isFile) {
    return [{ file: await readFileEntry(entry as FileSystemFileEntry), path }];
  }

  const childEntries = await readAllDirectoryEntries((entry as FileSystemDirectoryEntry).createReader());
  const nested = await Promise.all(childEntries.map((child) => collectFileSystemEntry(child, path)));
  return nested.flat();
}

function readFileEntry(entry: FileSystemFileEntry): Promise<File> {
  return new Promise((resolve, reject) => entry.file(resolve, reject));
}

async function readAllDirectoryEntries(reader: FileSystemDirectoryReader): Promise<FileSystemEntry[]> {
  const entries: FileSystemEntry[] = [];
  while (true) {
    const batch = await new Promise<FileSystemEntry[]>((resolve, reject) => reader.readEntries(resolve, reject));
    if (batch.length === 0) {
      return entries;
    }
    entries.push(...batch);
  }
}
