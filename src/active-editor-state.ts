import { useCallback, useEffect, useRef, useState } from 'react';
import type { EditorJumpTarget } from './components/CodeEditor';
import type { HexEditorJumpTarget } from './components/HexEditor';
import type { Translator } from './localization/i18n';
import { emptyStats } from './rton-value-analysis';
import type { RtonValue } from './rton-value';
import type {
  EditorSurface,
  JsonValue,
  RtonBinaryEncoding,
  StatusState,
  Tone,
  ViewMode,
} from './rton-codec';

export function useActiveEditorState({
  activeTabId,
  t,
}: {
  activeTabId: number | null;
  t: Translator;
}) {
  const [fileName, setFileName] = useState('');
  const [sourceBytes, setSourceBytes] = useState<Uint8Array | null>(null);
  const [binaryBytes, setBinaryBytes] = useState<Uint8Array | null>(null);
  const [binaryEncoding, setBinaryEncoding] = useState<RtonBinaryEncoding | null>(null);
  const [currentValue, setCurrentValue] = useState<RtonValue | null>(null);
  const [editorText, setEditorTextState] = useState('');
  const [editorJumpTarget, setEditorJumpTarget] = useState<EditorJumpTarget | null>(null);
  const [hexJumpTarget, setHexJumpTarget] = useState<HexEditorJumpTarget | null>(null);
  const [lastOutputBytes, setLastOutputBytes] = useState<number | null>(null);
  const [compactOutput, setCompactOutput] = useState(false);
  const [encryptOutput, setEncryptOutput] = useState(false);
  const [parsedJson, setParsedJson] = useState<JsonValue | null>(null);
  const [parseError, setParseError] = useState<string | null>(null);
  const [stats, setStats] = useState(() => emptyStats());
  const [viewMode, setViewModeState] = useState<ViewMode>('json');
  const [editorSurface, setEditorSurface] = useState<EditorSurface>('text');
  const [surfaceNote, setSurfaceNote] = useState(() => t('app.waitingFile'));
  const [status, setStatus] = useState<StatusState>(() => ({ message: t('status.wasmInitializing'), tone: 'warn' }));

  const currentValueRef = useRef<RtonValue | null>(currentValue);
  const viewModeRef = useRef<ViewMode>(viewMode);

  const setCurrentValueState = useCallback((value: RtonValue | null) => {
    currentValueRef.current = value;
    setCurrentValue(value);
  }, []);

  const updateStatus = useCallback((message: string, tone: Tone = 'warn') => {
    setStatus({ message, tone });
  }, []);

  useEffect(() => {
    viewModeRef.current = viewMode;
  }, [viewMode]);

  useEffect(() => {
    if (editorSurface === 'hex' && !binaryBytes) {
      setEditorSurface('text');
    }
  }, [binaryBytes, editorSurface]);

  useEffect(() => {
    currentValueRef.current = currentValue;
  }, [currentValue]);

  useEffect(() => {
    if (activeTabId === null) {
      setCompactOutput(false);
      setEncryptOutput(false);
      return;
    }
    if (binaryEncoding) {
      setCompactOutput(binaryEncoding.compact);
      setEncryptOutput(binaryEncoding.encrypted);
      return;
    }
    setCompactOutput(false);
    setEncryptOutput(false);
  }, [activeTabId, binaryEncoding]);

  return {
    binaryBytes,
    binaryEncoding,
    compactOutput,
    currentValue,
    currentValueRef,
    editorJumpTarget,
    editorSurface,
    editorText,
    encryptOutput,
    fileName,
    hexJumpTarget,
    lastOutputBytes,
    parseError,
    parsedJson,
    setBinaryBytes,
    setBinaryEncoding,
    setCompactOutput,
    setCurrentValueState,
    setEditorJumpTarget,
    setEditorSurface,
    setEditorTextState,
    setEncryptOutput,
    setFileName,
    setHexJumpTarget,
    setLastOutputBytes,
    setParseError,
    setParsedJson,
    setSourceBytes,
    setStats,
    setStatus,
    setSurfaceNote,
    setViewModeState,
    sourceBytes,
    stats,
    status,
    surfaceNote,
    updateStatus,
    viewMode,
    viewModeRef,
  };
}
