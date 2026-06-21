import type { RtonValue } from './rton-value';
import type { RtonValuePath } from './rton-value-editing';

type StructuredTextMode = 'json' | 'yaml' | 'toml';
type TextPosition = { line: number; column: number };
type TextLineInfo = { index: number; offset: number; text: string };
type RtonPathTraceSegment =
  | { kind: 'object'; index: number; key: string; value: RtonValue }
  | { kind: 'array'; index: number; value: RtonValue };

export function locateRtonPathInText(
  root: RtonValue,
  path: RtonValuePath,
  text: string,
  mode: StructuredTextMode,
): TextPosition | null {
  if (!text) {
    return null;
  }

  const offset =
    mode === 'json'
      ? locateJsonRtonPathOffset(text, root, path)
      : mode === 'yaml'
        ? locateYamlRtonPathOffset(text, root, path)
        : locateTomlRtonPathOffset(text, root, path);
  const fallbackOffset = offset ?? fallbackLocateRtonPathOffset(text, root, path);
  return fallbackOffset === null ? null : offsetToTextPosition(text, fallbackOffset);
}

function locateJsonRtonPathOffset(text: string, root: RtonValue, path: RtonValuePath) {
  try {
    return locateJsonValueOffset(text, skipJsonWhitespace(text, 0), root, path);
  } catch {
    return null;
  }
}

function locateJsonValueOffset(text: string, position: number, value: RtonValue, path: RtonValuePath): number | null {
  const pos = skipJsonWhitespace(text, position);
  if (path.length === 0) {
    return pos;
  }

  const [segment, ...rest] = path;
  if (segment.kind === 'object') {
    if (value.kind !== 'object' || text[pos] !== '{') {
      return null;
    }

    let cursor = pos + 1;
    for (let index = 0; index < value.entries.length; index += 1) {
      cursor = skipJsonWhitespace(text, cursor);
      if (text[cursor] === '}') {
        return null;
      }

      const keyStart = cursor;
      const keyEnd = scanJsonStringEnd(text, keyStart);
      if (keyEnd === null) {
        return null;
      }

      cursor = skipJsonWhitespace(text, keyEnd);
      if (text[cursor] !== ':') {
        return null;
      }

      const childStart = skipJsonWhitespace(text, cursor + 1);
      const entry = value.entries[index];
      if (segment.index === index) {
        return rest.length === 0 ? keyStart : locateJsonValueOffset(text, childStart, entry.value, rest);
      }

      const nextCursor = skipJsonValue(text, childStart);
      if (nextCursor === null) {
        return null;
      }
      cursor = skipJsonWhitespace(text, nextCursor);
      if (text[cursor] === ',') {
        cursor += 1;
      }
    }
    return null;
  }

  if (value.kind !== 'array' || text[pos] !== '[') {
    return null;
  }

  let cursor = pos + 1;
  for (let index = 0; index < value.items.length; index += 1) {
    const childStart = skipJsonWhitespace(text, cursor);
    if (text[childStart] === ']') {
      return null;
    }

    const item = value.items[index];
    if (segment.index === index) {
      return rest.length === 0 ? childStart : locateJsonValueOffset(text, childStart, item, rest);
    }

    const nextCursor = skipJsonValue(text, childStart);
    if (nextCursor === null) {
      return null;
    }
    cursor = skipJsonWhitespace(text, nextCursor);
    if (text[cursor] === ',') {
      cursor += 1;
    }
  }

  return null;
}

function skipJsonWhitespace(text: string, position: number) {
  let cursor = position;
  while (cursor < text.length && /\s/.test(text[cursor])) {
    cursor += 1;
  }
  return cursor;
}

function scanJsonStringEnd(text: string, position: number): number | null {
  if (text[position] !== '"') {
    return null;
  }

  let cursor = position + 1;
  while (cursor < text.length) {
    const char = text[cursor];
    if (char === '\\') {
      cursor += 2;
    } else if (char === '"') {
      return cursor + 1;
    } else {
      cursor += 1;
    }
  }
  return null;
}

function skipJsonValue(text: string, position: number): number | null {
  const pos = skipJsonWhitespace(text, position);
  const first = text[pos];
  if (first === '"') {
    return scanJsonStringEnd(text, pos);
  }

  if (first === '{' || first === '[') {
    const close = first === '{' ? '}' : ']';
    let depth = 0;
    let cursor = pos;
    while (cursor < text.length) {
      const char = text[cursor];
      if (char === '"') {
        const end = scanJsonStringEnd(text, cursor);
        if (end === null) {
          return null;
        }
        cursor = end;
        continue;
      }
      if (char === first) {
        depth += 1;
      } else if (char === close) {
        depth -= 1;
        if (depth === 0) {
          return cursor + 1;
        }
      }
      cursor += 1;
    }
    return null;
  }

  let cursor = pos;
  while (cursor < text.length && !',]}'.includes(text[cursor])) {
    cursor += 1;
  }
  return cursor;
}

function locateYamlRtonPathOffset(text: string, root: RtonValue, path: RtonValuePath) {
  const trace = traceRtonPath(root, path);
  if (!trace) {
    return null;
  }
  if (trace.length === 0) {
    return 0;
  }

  const lines = textLines(text);
  let startLine = 0;
  let indent = 0;
  let lastOffset: number | null = null;

  for (const segment of trace) {
    if (segment.kind === 'object') {
      const found = findYamlKeyLine(lines, startLine, indent, segment.key);
      if (!found) {
        return null;
      }
      lastOffset = found.offset;
      startLine = found.line.index;
      indent = leadingSpaces(found.line.text) + (found.line.text.trimStart().startsWith('- ') ? 2 : 2);
    } else {
      const found = findYamlArrayItemLine(lines, startLine, indent, segment.index);
      if (!found) {
        return null;
      }
      lastOffset = found.offset;
      startLine = found.line.index;
      indent = leadingSpaces(found.line.text) + 2;
    }
  }

  return lastOffset;
}

function findYamlKeyLine(lines: TextLineInfo[], startLine: number, indent: number, key: string) {
  for (let index = startLine; index < lines.length; index += 1) {
    const line = lines[index];
    const trimmed = line.text.trim();
    if (!trimmed || trimmed.startsWith('#')) {
      continue;
    }

    const leading = leadingSpaces(line.text);
    if (index > startLine && indent > 0 && leading < indent && !line.text.trimStart().startsWith('- ')) {
      break;
    }

    const offset = yamlKeyOffset(line, key, indent);
    if (offset !== null) {
      return { line, offset };
    }
  }
  return null;
}

function findYamlArrayItemLine(lines: TextLineInfo[], startLine: number, indent: number, targetIndex: number) {
  let seen = 0;
  for (let index = startLine; index < lines.length; index += 1) {
    const line = lines[index];
    const trimmed = line.text.trim();
    if (!trimmed || trimmed.startsWith('#')) {
      continue;
    }

    const leading = leadingSpaces(line.text);
    if (index > startLine && indent > 0 && leading < indent) {
      break;
    }

    const content = line.text.slice(leading);
    if (leading === indent && content.startsWith('-')) {
      if (seen === targetIndex) {
        return { line, offset: line.offset + leading };
      }
      seen += 1;
    }
  }
  return null;
}

function yamlKeyOffset(line: TextLineInfo, key: string, indent: number) {
  const leading = leadingSpaces(line.text);
  const content = line.text.slice(leading);
  const keyOffset = yamlKeyPrefixOffset(content, key);
  if (leading === indent && keyOffset !== null) {
    return line.offset + leading + keyOffset;
  }

  if (leading === Math.max(0, indent - 2) && content.startsWith('- ')) {
    const inlineKeyOffset = yamlKeyPrefixOffset(content.slice(2), key);
    if (inlineKeyOffset !== null) {
      return line.offset + leading + 2 + inlineKeyOffset;
    }
  }

  return null;
}

function yamlKeyPrefixOffset(content: string, key: string) {
  for (const form of keyForms(key)) {
    if (content.startsWith(`${form}:`) || content.startsWith(`${form} :`)) {
      return 0;
    }
  }
  return null;
}

function locateTomlRtonPathOffset(text: string, root: RtonValue, path: RtonValuePath) {
  const trace = traceRtonPath(root, path);
  if (!trace) {
    return null;
  }
  if (trace.length === 0) {
    return 0;
  }

  const lines = textLines(text);
  const objectSegments = trace.filter((segment) => segment.kind === 'object');
  for (let index = objectSegments.length - 1; index >= 0; index -= 1) {
    const key = objectSegments[index].key;
    const assignment = findTomlAssignmentLine(lines, key);
    if (assignment) {
      return assignment;
    }
    const header = findTomlHeaderLine(lines, key);
    if (header) {
      return header;
    }
  }
  return null;
}

function findTomlAssignmentLine(lines: TextLineInfo[], key: string) {
  for (const line of lines) {
    const leading = leadingSpaces(line.text);
    const content = line.text.slice(leading);
    if (!content || content.startsWith('#') || content.startsWith('[')) {
      continue;
    }
    for (const form of keyForms(key)) {
      if (content.startsWith(form) && /^\s*=/.test(content.slice(form.length))) {
        return line.offset + leading;
      }
    }
  }
  return null;
}

function findTomlHeaderLine(lines: TextLineInfo[], key: string) {
  for (const line of lines) {
    const content = line.text.trim();
    if (!content.startsWith('[')) {
      continue;
    }
    const keyIndex = line.text.indexOf(key);
    if (keyIndex >= 0) {
      return line.offset + keyIndex;
    }
  }
  return null;
}

function fallbackLocateRtonPathOffset(text: string, root: RtonValue, path: RtonValuePath) {
  if (path.length === 0) {
    return 0;
  }

  const trace = traceRtonPath(root, path);
  let segment: RtonPathTraceSegment | null = null;
  for (let index = (trace?.length ?? 0) - 1; index >= 0; index -= 1) {
    const item = trace?.[index];
    if (item?.kind === 'object') {
      segment = item;
      break;
    }
  }
  if (!segment || segment.kind !== 'object') {
    return null;
  }

  const quotedIndex = text.indexOf(JSON.stringify(segment.key));
  if (quotedIndex >= 0) {
    return quotedIndex;
  }
  const plainIndex = text.indexOf(segment.key);
  return plainIndex >= 0 ? plainIndex : null;
}

function traceRtonPath(root: RtonValue, path: RtonValuePath): RtonPathTraceSegment[] | null {
  const trace: RtonPathTraceSegment[] = [];
  let value = root;

  for (const segment of path) {
    if (segment.kind === 'object') {
      if (value.kind !== 'object') {
        return null;
      }
      const entry = value.entries[segment.index];
      if (!entry) {
        return null;
      }
      trace.push({ kind: 'object', index: segment.index, key: entry.key, value: entry.value });
      value = entry.value;
    } else {
      if (value.kind !== 'array') {
        return null;
      }
      const item = value.items[segment.index];
      if (!item) {
        return null;
      }
      trace.push({ kind: 'array', index: segment.index, value: item });
      value = item;
    }
  }

  return trace;
}

function textLines(text: string): TextLineInfo[] {
  const rawLines = text.split('\n');
  let offset = 0;
  return rawLines.map((line, index) => {
    const cleanLine = line.endsWith('\r') ? line.slice(0, -1) : line;
    const info = { index, offset, text: cleanLine };
    offset += line.length + 1;
    return info;
  });
}

function leadingSpaces(text: string) {
  return text.length - text.trimStart().length;
}

function keyForms(key: string) {
  return [key, JSON.stringify(key), `'${key.replace(/'/g, "''")}'`];
}

function offsetToTextPosition(text: string, offset: number): TextPosition {
  const boundedOffset = Math.min(Math.max(0, offset), text.length);
  let line = 1;
  let lineStart = 0;
  for (let index = 0; index < boundedOffset; index += 1) {
    if (text[index] === '\n') {
      line += 1;
      lineStart = index + 1;
    }
  }
  return { line, column: boundedOffset - lineStart };
}
