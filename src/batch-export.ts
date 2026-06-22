import type { StructuredFormatMode } from './format-conversion';
import {
  batchOutputPath,
  createZipArchive,
  uniqueZipPath,
  yieldToBrowser,
  type ZipFileEntry,
} from './file-export';
import { encodeRtonOutputBytes, rtonValueToJsonText } from './rton-codec';
import type { RtonValue } from './rton-value';

export type BatchExportMode = 'rton' | 'json' | 'yaml' | 'toml';

export type BatchExportItem = {
  path: string;
};

export type BatchStructuredFormatter = (value: RtonValue, mode: StructuredFormatMode) => string;

export type BatchExportEncodeOptions = {
  compact: boolean;
  encrypted: boolean;
  structuredFormatter: BatchStructuredFormatter | null;
};

export type BatchExportArchiveResult = {
  exportedCount: number;
  errors: string[];
  zipBytes: Uint8Array | null;
};

export async function createBatchExportArchive<TItem extends BatchExportItem>({
  items,
  mode,
  resolveValue,
  encodeValue,
  describeError,
}: {
  items: TItem[];
  mode: BatchExportMode;
  resolveValue: (item: TItem) => Promise<RtonValue> | RtonValue;
  encodeValue: (value: RtonValue, mode: BatchExportMode) => Uint8Array;
  describeError: (error: unknown) => string;
}): Promise<BatchExportArchiveResult> {
  const usedPaths = new Set<string>();
  const zipEntries: ZipFileEntry[] = [];
  const errors: string[] = [];

  for (let index = 0; index < items.length; index += 1) {
    const item = items[index];
    try {
      const value = await resolveValue(item);
      zipEntries.push({
        path: uniqueZipPath(batchOutputPath(item.path, mode), usedPaths),
        bytes: encodeValue(value, mode),
      });
    } catch (error) {
      errors.push(`${item.path}: ${describeError(error)}`);
    }

    if (index % 24 === 23) {
      await yieldToBrowser();
    }
  }

  return {
    exportedCount: zipEntries.length,
    errors,
    zipBytes: zipEntries.length === 0 ? null : createZipArchive(zipEntries),
  };
}

export function encodeBatchExportValue(
  value: RtonValue,
  mode: BatchExportMode,
  options: BatchExportEncodeOptions,
) {
  if (mode === 'rton') {
    return encodeRtonOutputBytes(value, options.compact, options.encrypted);
  }

  const encoder = new TextEncoder();
  if (mode === 'json') {
    return encoder.encode(rtonValueToJsonText(value, true));
  }

  if (!options.structuredFormatter) {
    throw new Error(`${mode.toUpperCase()} formatter is unavailable`);
  }
  return encoder.encode(options.structuredFormatter(value, mode));
}
