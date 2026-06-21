import type { RtonValue } from './rton-value';
import {
  isRtonNumberKind,
  previewRtonValue,
  type RtonValuePath,
  type SearchMatch,
  type SearchState,
} from './rton-value-editing';

export type Stats = {
  nodes: number;
  objects: number;
  arrays: number;
  strings: number;
  numbers: number;
  booleans: number;
  nulls: number;
  rtids: number;
  binaries: number;
  maxDepth: number;
};

type SearchFrame =
  | { kind: 'value'; value: RtonValue; path: string; valuePath: RtonValuePath }
  | { kind: 'array'; value: RtonValue[]; path: string; valuePath: RtonValuePath; index: number }
  | { kind: 'object'; value: Array<{ key: string; value: RtonValue }>; path: string; valuePath: RtonValuePath; index: number };

export const RTON_SEARCH_MATCH_LIMIT = 120;
const SEARCH_CHUNK_MS = 10;

export function runChunkedSearch(
  value: RtonValue,
  query: string,
  searchId: number,
  activeSearchId: { current: number },
  setSearchState: (state: SearchState) => void,
) {
  const matches: SearchMatch[] = [];
  const stack: SearchFrame[] = [{ kind: 'value', value, path: '$', valuePath: [] }];
  let scanned = 0;
  let lastPaint = 0;

  const runChunk = () => {
    if (searchId !== activeSearchId.current) {
      return;
    }

    const started = performance.now();
    while (stack.length > 0 && matches.length < RTON_SEARCH_MATCH_LIMIT && performance.now() - started < SEARCH_CHUNK_MS) {
      const frame = stack.pop();
      if (!frame) {
        continue;
      }

      if (frame.kind === 'array') {
        if (frame.index < frame.value.length) {
          const index = frame.index;
          frame.index += 1;
          stack.push(frame);
          stack.push({
            kind: 'value',
            value: frame.value[index],
            path: `${frame.path}[${index}]`,
            valuePath: [...frame.valuePath, { kind: 'array' as const, index }],
          });
        }
        continue;
      }

      if (frame.kind === 'object') {
        if (frame.index < frame.value.length) {
          const entry = frame.value[frame.index];
          const index = frame.index;
          frame.index += 1;
          stack.push(frame);
          stack.push({
            kind: 'value',
            value: entry.value,
            path: childPath(frame.path, entry.key),
            valuePath: [...frame.valuePath, { kind: 'object' as const, index }],
          });
        }
        continue;
      }

      scanned += 1;
      const preview = previewRtonValue(frame.value);
      if (frame.path.toLowerCase().includes(query) || preview.toLowerCase().includes(query)) {
        matches.push({ path: frame.path, preview, valuePath: frame.valuePath });
      }

      if (frame.value.kind === 'array') {
        stack.push({ kind: 'array', value: frame.value.items, path: frame.path, valuePath: frame.valuePath, index: 0 });
      } else if (frame.value.kind === 'object') {
        stack.push({ kind: 'object', value: frame.value.entries, path: frame.path, valuePath: frame.valuePath, index: 0 });
      }
    }

    const done = stack.length === 0;
    const capped = matches.length >= RTON_SEARCH_MATCH_LIMIT;
    const now = performance.now();
    if (now - lastPaint > 90 || done || capped) {
      setSearchState({ kind: 'results', query, matches: [...matches], scanned, done, capped });
      lastPaint = now;
    }

    if (!done && !capped) {
      window.setTimeout(runChunk, 0);
    }
  };

  window.setTimeout(runChunk, 0);
}

export function collectStats(value: RtonValue): Stats {
  const stats = emptyStats();
  const stack: Array<{ value: RtonValue; depth: number }> = [{ value, depth: 1 }];

  while (stack.length > 0) {
    const item = stack.pop();
    if (!item) {
      continue;
    }

    stats.nodes += 1;
    stats.maxDepth = Math.max(stats.maxDepth, item.depth);
    const current = item.value;

    if (current.kind === 'array') {
      stats.arrays += 1;
      for (let index = current.items.length - 1; index >= 0; index -= 1) {
        stack.push({ value: current.items[index], depth: item.depth + 1 });
      }
    } else if (current.kind === 'object') {
      stats.objects += 1;
      for (let index = current.entries.length - 1; index >= 0; index -= 1) {
        stack.push({ value: current.entries[index].value, depth: item.depth + 1 });
      }
    } else if (current.kind === 'string') {
      stats.strings += 1;
    } else if (current.kind === 'binary') {
      stats.binaries += 1;
    } else if (current.kind === 'rtid') {
      stats.rtids += 1;
    } else if (isRtonNumberKind(current.kind)) {
      stats.numbers += 1;
    } else if (current.kind === 'bool') {
      stats.booleans += 1;
    } else {
      stats.nulls += 1;
    }
  }

  return stats;
}

export function emptyStats(): Stats {
  return {
    nodes: 0,
    objects: 0,
    arrays: 0,
    strings: 0,
    numbers: 0,
    booleans: 0,
    nulls: 0,
    rtids: 0,
    binaries: 0,
    maxDepth: 0,
  };
}

function childPath(parent: string, key: string) {
  return /^[A-Za-z_$][\w$]*$/.test(key) ? `${parent}.${key}` : `${parent}[${JSON.stringify(key)}]`;
}
