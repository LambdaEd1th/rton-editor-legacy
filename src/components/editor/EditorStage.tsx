import { FolderOpen } from 'lucide-react';
import { LOADABLE_FILE_HINT } from '../../files/file-loading';
import type { Translator } from '../../localization/i18n';
import type { EditorSurface, ViewMode } from '../../domain/rton-codec';
import type { HexByteSource } from '../../domain/hex-byte-source';
import { CodeEditor, type EditorJumpTarget } from './CodeEditor';
import { HexEditor, type HexEditorJumpTarget } from './HexEditor';
import { LazyHexEditor } from './LazyHexEditor';

export function EditorStage({
  t,
  displayedHexBytes,
  displayedHexSource,
  editorJumpTarget,
  editorSearchPanelVisible,
  editorSurface,
  editorText,
  hasActiveFile,
  hexJumpTarget,
  lineWrapping,
  viewMode,
  onEditorChange,
  onHexChange,
  onReadHexRange,
  onSearchPanelVisibleChange,
}: {
  t: Translator;
  displayedHexBytes: Uint8Array | null;
  displayedHexSource: HexByteSource | null;
  editorJumpTarget: EditorJumpTarget | null;
  editorSearchPanelVisible: boolean;
  editorSurface: EditorSurface;
  editorText: string;
  hasActiveFile: boolean;
  hexJumpTarget: HexEditorJumpTarget | null;
  lineWrapping: boolean;
  viewMode: ViewMode;
  onEditorChange: (value: string) => void;
  onHexChange: (bytes: Uint8Array) => void;
  onReadHexRange: (source: HexByteSource, start: number, end: number) => Promise<Uint8Array>;
  onSearchPanelVisibleChange: (visible: boolean) => void;
}) {
  if (hasActiveFile && editorSurface === 'hex' && displayedHexBytes) {
    return (
      <section className="rton-editor-stage">
        <HexEditor
          bytes={displayedHexBytes}
          jumpTarget={hexJumpTarget}
          searchPanelVisible={editorSearchPanelVisible}
          onChange={onHexChange}
          onSearchPanelVisibleChange={onSearchPanelVisibleChange}
        />
      </section>
    );
  }

  if (hasActiveFile && editorSurface === 'hex' && displayedHexSource) {
    return (
      <section className="rton-editor-stage">
        <LazyHexEditor
          source={displayedHexSource}
          jumpTarget={hexJumpTarget}
          searchPanelVisible={editorSearchPanelVisible}
          readRange={onReadHexRange}
          onSearchPanelVisibleChange={onSearchPanelVisibleChange}
        />
      </section>
    );
  }

  if (hasActiveFile) {
    return (
      <section className="rton-editor-stage">
        <CodeEditor
          value={editorText}
          mode={viewMode}
          lineWrapping={lineWrapping}
          jumpTarget={editorJumpTarget}
          searchPanelVisible={editorSearchPanelVisible}
          onChange={onEditorChange}
          onSearchPanelVisibleChange={onSearchPanelVisibleChange}
        />
      </section>
    );
  }

  return (
    <section className="rton-editor-stage">
      <div className="rton-empty-drop-stage flex h-full min-h-0 flex-col items-center justify-center p-6 text-center">
        <FolderOpen aria-hidden="true" className="mb-3 h-12 w-12 text-[var(--color-accent-text)] opacity-70" />
        <div className="mb-1 max-w-[460px] text-[17px] font-semibold text-[var(--color-drop-hint)]">{t('drop.title')}</div>
        <div className="text-[13px] text-[var(--color-drop-hint-sub)]">{t('drop.subtitle', { hint: LOADABLE_FILE_HINT })}</div>
      </div>
    </section>
  );
}
