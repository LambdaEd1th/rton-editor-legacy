import * as jsYaml from 'js-yaml';
import * as smolToml from 'smol-toml';
import type { TomlTableWithoutBigInt } from 'smol-toml';
import { plainToRtonValue, rtonValueToPlain, type RtonValue } from './rton-value';

export type StructuredFormatMode = 'yaml' | 'toml';

export function formatStructuredText(value: RtonValue, mode: StructuredFormatMode) {
  const plainValue = rtonValueToPlain(value);
  return mode === 'yaml' ? formatYaml(plainValue) : formatToml(plainValue);
}

export function parseStructuredText(text: string, mode: StructuredFormatMode) {
  const parsed = mode === 'yaml' ? jsYaml.load(text) : smolToml.parse(text);
  const value = plainToRtonValue(parsed ?? null);
  return { value, plainValue: rtonValueToPlain(value) };
}

function formatYaml(value: unknown) {
  return jsYaml.dump(value, {
    lineWidth: -1,
    noRefs: true,
    sortKeys: false,
  });
}

function formatToml(value: unknown) {
  if (!isRecord(value)) {
    throw new Error('TOML requires a top-level object. Use JSON or YAML for this value.');
  }

  return smolToml.stringify(value as TomlTableWithoutBigInt);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
