import { useRef } from 'react';
import { CheckCircle2, Download, FileJson, FileText, FileUp, FolderOpen, Redo2, Undo2 } from 'lucide-react';
import type { StructuredFormatMode } from '../../domain/format-conversion';
import { LOADABLE_FILE_ACCEPT } from '../../files/file-loading';
import type { Translator } from '../../localization/i18n';
import type { ThemePreference } from '../../workspace/preferences';
import type { EditorSurface, ViewMode } from '../../domain/rton-codec';
import { buttonClass, modeButtonClass } from '../../utils/ui-classes';
import { DraggableToolbar, type ToolbarGroupConfig, type ToolbarGroupId } from './DraggableToolbar';
import type { EditorShortcutKind } from '../editor/keyboard-shortcuts';
import { RtonInlineSelect, type RtonInlineSelectOption } from '../inspector/RtonInlineSelect';

export function AppToolbar({
  t,
  canOpenHexEditor,
  compactOutput,
  displayFileName,
  displaySurfaceNote,
  editorSearchPanelVisible,
  editorSurface,
  encryptOutput,
  hasActiveFile,
  lang,
  languageOptions,
  lineWrapping,
  themeOptions,
  themePreference,
  viewMode,
  wasmReady,
  onCompactOutputChange,
  onDownloadJson,
  onDownloadRton,
  onDownloadStructuredFormat,
  onEditorAction,
  onEditorSearchPanelVisibleChange,
  onEncryptOutputChange,
  onLanguageChange,
  onLineWrappingChange,
  onLoadSample,
  onOpenFiles,
  onOpenFolder,
  onOpenHexEditor,
  onThemePreferenceChange,
  onValidate,
  onViewModeChange,
}: {
  t: Translator;
  canOpenHexEditor: boolean;
  compactOutput: boolean;
  displayFileName: string;
  displaySurfaceNote: string;
  editorSearchPanelVisible: boolean;
  editorSurface: EditorSurface;
  encryptOutput: boolean;
  hasActiveFile: boolean;
  lang: string;
  languageOptions: Array<RtonInlineSelectOption<string>>;
  lineWrapping: boolean;
  themeOptions: Array<RtonInlineSelectOption<ThemePreference>>;
  themePreference: ThemePreference;
  viewMode: ViewMode;
  wasmReady: boolean;
  onCompactOutputChange: (checked: boolean) => void;
  onDownloadJson: () => void;
  onDownloadRton: () => void | Promise<void>;
  onDownloadStructuredFormat: (mode: StructuredFormatMode) => void | Promise<void>;
  onEditorAction: (kind: EditorShortcutKind) => void;
  onEditorSearchPanelVisibleChange: (visible: boolean) => void;
  onEncryptOutputChange: (checked: boolean) => void;
  onLanguageChange: (lang: string) => void;
  onLineWrappingChange: (enabled: boolean) => void;
  onLoadSample: () => void;
  onOpenFiles: (files: File[]) => void | Promise<void>;
  onOpenFolder: () => void | Promise<void>;
  onOpenHexEditor: () => void;
  onThemePreferenceChange: (preference: ThemePreference) => void;
  onValidate: () => void;
  onViewModeChange: (mode: ViewMode) => void;
}) {
  const fileInputRef = useRef<HTMLInputElement | null>(null);

  const toolbarGroups = {
    file: {
      label: t('toolbar.file'),
      content: (
        <>
          <button type="button" onClick={() => fileInputRef.current?.click()} className={buttonClass('primary')}>
            <FileUp />
            {t('toolbar.openFile')}
          </button>
          <button type="button" onClick={() => void onOpenFolder()} className={buttonClass('secondary')}>
            <FolderOpen />
            {t('toolbar.openFolder')}
          </button>
          <button type="button" onClick={onLoadSample} className={buttonClass('secondary')}>
            {t('toolbar.sample')}
          </button>
          <span className="min-w-24 max-w-80 flex-1 truncate px-1 font-semibold text-[var(--color-text-strong)]">{displayFileName}</span>
        </>
      ),
    },
    edit: {
      label: t('toolbar.edit'),
      ariaLabel: t('toolbar.edit'),
      content: (
        <>
          <button
            type="button"
            onClick={() => onEditorAction('undo')}
            disabled={!hasActiveFile}
            className={buttonClass('secondary')}
          >
            <Undo2 />
            {t('toolbar.undo')}
          </button>
          <button
            type="button"
            onClick={() => onEditorAction('redo')}
            disabled={!hasActiveFile}
            className={buttonClass('secondary')}
          >
            <Redo2 />
            {t('toolbar.redo')}
          </button>
        </>
      ),
    },
    format: {
      label: t('toolbar.textFormat'),
      role: 'tablist',
      ariaLabel: t('toolbar.textFormat'),
      content: (
        <>
          <button
            type="button"
            role="tab"
            disabled={!canOpenHexEditor}
            aria-selected={editorSurface === 'hex'}
            className={modeButtonClass(editorSurface === 'hex')}
            onClick={onOpenHexEditor}
          >
            RTON
          </button>
          {(['json', 'yaml', 'toml'] as const).map((mode) => (
            <button
              key={mode}
              type="button"
              role="tab"
              disabled={!hasActiveFile}
              aria-selected={editorSurface === 'text' && viewMode === mode}
              className={modeButtonClass(editorSurface === 'text' && viewMode === mode)}
              onClick={() => onViewModeChange(mode)}
            >
              {mode.toUpperCase()}
            </button>
          ))}
          <span className="max-w-52 truncate px-1 text-xs uppercase text-[var(--color-text-muted)] max-lg:hidden">{displaySurfaceNote}</span>
        </>
      ),
    },
    textExport: {
      label: t('toolbar.textExport'),
      ariaLabel: t('toolbar.textExport'),
      content: (
        <>
          <button type="button" onClick={onDownloadJson} disabled={!hasActiveFile} className={buttonClass('secondary')}>
            <FileJson />
            JSON
          </button>
          <button
            type="button"
            onClick={() => void onDownloadStructuredFormat('yaml')}
            disabled={!hasActiveFile}
            className={buttonClass('secondary')}
          >
            <FileText />
            YAML
          </button>
          <button
            type="button"
            onClick={() => void onDownloadStructuredFormat('toml')}
            disabled={!hasActiveFile}
            className={buttonClass('secondary')}
          >
            <FileText />
            TOML
          </button>
        </>
      ),
    },
    rtonExport: {
      label: t('toolbar.rtonExport'),
      ariaLabel: t('toolbar.rtonExport'),
      content: (
        <>
          <label className="rton-switch">
            <input
              type="checkbox"
              checked={compactOutput}
              disabled={!hasActiveFile}
              className="rton-switch-input"
              onChange={(event) => onCompactOutputChange(event.currentTarget.checked)}
            />
            <span className="rton-switch-label">{t('toolbar.compact')}</span>
            <span className="rton-switch-track" aria-hidden="true" />
          </label>
          <label className="rton-switch">
            <input
              type="checkbox"
              checked={encryptOutput}
              disabled={!hasActiveFile}
              className="rton-switch-input"
              onChange={(event) => onEncryptOutputChange(event.currentTarget.checked)}
            />
            <span className="rton-switch-label">{t('toolbar.encrypted')}</span>
            <span className="rton-switch-track" aria-hidden="true" />
          </label>
          <button type="button" onClick={onValidate} disabled={!hasActiveFile || !wasmReady} className={buttonClass('secondary')}>
            <CheckCircle2 />
            {t('toolbar.validate')}
          </button>
          <button type="button" onClick={() => void onDownloadRton()} disabled={!hasActiveFile || !wasmReady} className={buttonClass('primary')}>
            <Download />
            RTON
          </button>
        </>
      ),
    },
    prefs: {
      label: t('toolbar.preferences'),
      ariaLabel: t('toolbar.preferences'),
      content: (
        <>
          <label className="rton-theme-label">
            <span>{t('toolbar.theme')}</span>
            <RtonInlineSelect
              value={themePreference}
              options={themeOptions}
              ariaLabel={t('toolbar.chooseTheme')}
              variant="toolbar"
              className="rton-theme-select"
              onChange={onThemePreferenceChange}
            />
          </label>
          <label className="rton-theme-label">
            <span>{t('toolbar.language')}</span>
            <RtonInlineSelect
              value={lang}
              options={languageOptions}
              ariaLabel={t('toolbar.chooseLanguage')}
              variant="toolbar"
              className="rton-theme-select"
              onChange={onLanguageChange}
            />
          </label>
          <label className="rton-switch">
            <input
              type="checkbox"
              checked={lineWrapping}
              className="rton-switch-input"
              aria-label={t('toolbar.lineWrap')}
              onChange={(event) => onLineWrappingChange(event.currentTarget.checked)}
            />
            <span className="rton-switch-label">{t('toolbar.lineWrap')}</span>
            <span className="rton-switch-track" aria-hidden="true" />
          </label>
          <label className="rton-switch">
            <input
              type="checkbox"
              checked={hasActiveFile && editorSearchPanelVisible}
              disabled={!hasActiveFile}
              className="rton-switch-input"
              aria-label={t('toolbar.searchPanel')}
              onChange={(event) => onEditorSearchPanelVisibleChange(event.currentTarget.checked)}
            />
            <span className="rton-switch-label">{t('toolbar.searchPanel')}</span>
            <span className="rton-switch-track" aria-hidden="true" />
          </label>
        </>
      ),
    },
  } satisfies Record<ToolbarGroupId, ToolbarGroupConfig>;

  return (
    <header className="rton-toolbar">
      <DraggableToolbar groups={toolbarGroups} />
      <input
        ref={fileInputRef}
        type="file"
        multiple
        accept={LOADABLE_FILE_ACCEPT}
        className="hidden"
        onChange={(event) => {
          const files = Array.from(event.currentTarget.files ?? []);
          if (files.length > 0) {
            void onOpenFiles(files);
          }
          event.currentTarget.value = '';
        }}
      />
    </header>
  );
}
