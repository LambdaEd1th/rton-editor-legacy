import { useEffect, useRef } from 'react';
import { basicSetup } from 'codemirror';
import { indentWithTab, redo, undo } from '@codemirror/commands';
import { json } from '@codemirror/lang-json';
import { yaml } from '@codemirror/lang-yaml';
import { HighlightStyle, StreamLanguage, syntaxHighlighting } from '@codemirror/language';
import { toml } from '@codemirror/legacy-modes/mode/toml';
import { closeSearchPanel, openSearchPanel, searchPanelOpen as isSearchPanelOpen } from '@codemirror/search';
import { Compartment, EditorState, Prec, type Extension } from '@codemirror/state';
import { EditorView, keymap, type ViewUpdate } from '@codemirror/view';
import { tags } from '@lezer/highlight';
import { registerEditorShortcutOwner } from './keyboard-shortcuts';
import { useI18n } from '../localization/use-i18n';

type EditorMode = 'json' | 'yaml' | 'toml';

export type EditorJumpTarget = {
  id: number;
  line: number;
  column?: number;
};

type CodeEditorProps = {
  value: string;
  mode: EditorMode;
  lineWrapping: boolean;
  jumpTarget: EditorJumpTarget | null;
  searchPanelVisible: boolean;
  onChange: (value: string) => void;
  onSearchPanelVisibleChange: (visible: boolean) => void;
};

const editorTheme = EditorView.theme(
  {
    '&': {
      height: '100%',
      backgroundColor: 'var(--color-stage)',
      color: 'var(--color-text-strong)',
      fontSize: '13px',
    },
    '&.cm-focused': {
      outline: 'none',
    },
    '.cm-scroller': {
      fontFamily:
        'ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, "Liberation Mono", "Courier New", monospace',
      lineHeight: '1.55',
    },
    '.cm-content': {
      minHeight: '100%',
      padding: '14px 18px',
    },
    '.cm-line': {
      padding: '0 2px',
    },
    '.cm-gutters': {
      backgroundColor: 'var(--color-stage)',
      borderRight: '1px solid var(--color-border)',
      color: 'var(--color-text-subtle)',
    },
    '.cm-activeLine': {
      backgroundColor: 'rgba(101, 221, 210, 0.055)',
    },
    '.cm-activeLineGutter': {
      backgroundColor: 'var(--color-surface-soft)',
      color: 'var(--color-text-strong)',
    },
    '.cm-cursor': {
      borderLeftColor: 'var(--color-accent-text)',
    },
    '.cm-selectionBackground, &.cm-focused .cm-selectionBackground': {
      backgroundColor: 'rgba(101, 221, 210, 0.24)',
    },
    '.cm-panels': {
      backgroundColor: 'var(--color-surface-raised)',
      borderColor: 'var(--color-border)',
      color: 'var(--color-text-strong)',
      fontFamily: '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif',
      fontSize: '13px',
    },
    '.cm-panels-top': {
      borderBottom: '1px solid var(--color-border)',
    },
    '.cm-panels-bottom': {
      borderTop: '1px solid var(--color-border)',
    },
    '.cm-panel.cm-search': {
      display: 'flex',
      position: 'relative',
      minWidth: 0,
      alignItems: 'center',
      gap: '6px',
      flexWrap: 'wrap',
      padding: '8px 10px',
    },
    '.cm-panel.cm-search br': {
      display: 'none',
    },
    '.cm-panel.cm-search input, .cm-panel.cm-search button, .cm-panel.cm-search label': {
      margin: 0,
    },
    '.cm-textfield': {
      height: '28px',
      minWidth: '110px',
      maxWidth: 'min(260px, 100%)',
      border: '1px solid var(--color-border-strong)',
      borderRadius: 'var(--radius)',
      backgroundColor: 'var(--color-control)',
      color: 'var(--color-text-strong)',
      font: 'inherit',
      fontSize: '13px',
      lineHeight: '26px',
      padding: '0 8px',
      verticalAlign: 'middle',
    },
    '.cm-panel.cm-search .cm-textfield[name="search"]': {
      flex: '1 1 180px',
    },
    '.cm-panel.cm-search .cm-textfield[name="replace"]': {
      flex: '1 1 160px',
    },
    '.cm-textfield::placeholder': {
      color: 'var(--color-placeholder)',
    },
    '.cm-textfield:hover': {
      backgroundColor: 'var(--color-control-hover)',
    },
    '.cm-textfield:focus': {
      borderColor: 'var(--color-accent-border)',
      outline: '2px solid var(--color-focus)',
      outlineOffset: '1px',
    },
    '.cm-button': {
      display: 'inline-flex',
      height: '28px',
      minWidth: '0',
      alignItems: 'center',
      justifyContent: 'center',
      border: '1px solid var(--color-border-strong)',
      borderRadius: 'var(--radius)',
      backgroundColor: 'var(--color-control)',
      backgroundImage: 'none',
      color: 'var(--color-text-strong)',
      font: 'inherit',
      fontSize: '13px',
      lineHeight: 1,
      padding: '0 10px',
      transition: 'background-color 120ms ease, border-color 120ms ease, color 120ms ease',
      verticalAlign: 'middle',
      whiteSpace: 'nowrap',
    },
    '.cm-button:hover': {
      borderColor: 'var(--color-border-stronger)',
      backgroundColor: 'var(--color-control-hover)',
    },
    '.cm-button:active': {
      backgroundColor: 'var(--color-control-active)',
      color: 'var(--color-accent-text)',
    },
    '.cm-button:focus-visible': {
      borderColor: 'var(--color-accent-border)',
      outline: '2px solid var(--color-focus)',
      outlineOffset: '1px',
    },
    '.cm-panel.cm-search label': {
      display: 'inline-flex',
      minHeight: '28px',
      alignItems: 'center',
      gap: '5px',
      color: 'var(--color-text-muted)',
      fontSize: '13px',
      lineHeight: 1,
      whiteSpace: 'nowrap',
    },
    '.cm-panel.cm-search input[type="checkbox"]': {
      width: '14px',
      height: '14px',
      flex: '0 0 14px',
      accentColor: 'var(--color-accent)',
      margin: 0,
    },
    '.cm-panel.cm-search [name="close"]': {
      position: 'static',
      width: '28px',
      minWidth: '28px',
      height: '28px',
      marginLeft: 'auto',
      border: '1px solid transparent',
      borderRadius: 'var(--radius)',
      backgroundColor: 'transparent',
      color: 'var(--color-text-muted)',
      font: 'inherit',
      fontSize: '18px',
      lineHeight: 1,
      padding: 0,
    },
    '.cm-panel.cm-search [name="close"]:hover': {
      borderColor: 'var(--color-border)',
      backgroundColor: 'var(--color-control-hover)',
      color: 'var(--color-text-strong)',
    },
    '.cm-dialog': {
      display: 'flex',
      alignItems: 'center',
      gap: '6px',
      padding: '8px 10px',
      backgroundColor: 'var(--color-surface-raised)',
      color: 'var(--color-text-strong)',
      fontFamily: '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif',
      fontSize: '13px',
    },
    '.cm-dialog label': {
      color: 'var(--color-text-muted)',
      fontSize: '13px',
      whiteSpace: 'nowrap',
    },
    '.cm-dialog-close': {
      top: '7px',
      right: '8px',
      width: '24px',
      height: '24px',
      border: '1px solid transparent',
      borderRadius: 'var(--radius)',
      backgroundColor: 'transparent',
      color: 'var(--color-text-muted)',
      font: 'inherit',
      fontSize: '16px',
      lineHeight: 1,
    },
    '.cm-dialog-close:hover': {
      borderColor: 'var(--color-border)',
      backgroundColor: 'var(--color-control-hover)',
      color: 'var(--color-text-strong)',
    },
    '.cm-searchMatch': {
      borderRadius: '2px',
      backgroundColor: 'color-mix(in srgb, var(--color-accent) 18%, transparent)',
      boxShadow: '0 0 0 1px color-mix(in srgb, var(--color-accent) 28%, transparent) inset',
    },
    '.cm-searchMatch-selected': {
      backgroundColor: 'color-mix(in srgb, var(--color-accent) 32%, transparent)',
      boxShadow: '0 0 0 1px color-mix(in srgb, var(--color-accent-border) 70%, transparent) inset',
    },
    '.cm-tooltip': {
      backgroundColor: 'var(--color-surface-raised)',
      border: '1px solid var(--color-border-strong)',
      borderRadius: 'var(--radius)',
      boxShadow: '0 10px 26px var(--color-shadow)',
      color: 'var(--color-text-strong)',
      fontFamily: '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif',
      fontSize: '13px',
    },
    '.cm-tooltip-autocomplete': {
      padding: '4px',
    },
    '.cm-tooltip-autocomplete ul': {
      padding: 0,
    },
    '.cm-tooltip-autocomplete ul li': {
      minHeight: '26px',
      borderRadius: '4px',
      padding: '5px 8px',
    },
    '.cm-tooltip-autocomplete ul li[aria-selected]': {
      backgroundColor: 'var(--color-control-hover)',
      color: 'var(--color-accent-text)',
    },
  },
  { dark: true },
);

const rtonHighlightStyle = HighlightStyle.define([
  { tag: tags.comment, color: 'var(--color-code-comment)', fontStyle: 'italic' },
  { tag: [tags.propertyName, tags.definition(tags.propertyName)], color: 'var(--color-code-property)' },
  { tag: [tags.name, tags.variableName, tags.definition(tags.variableName)], color: 'var(--color-code-name)' },
  { tag: [tags.keyword, tags.operatorKeyword, tags.null, tags.atom], color: 'var(--color-code-keyword)' },
  { tag: tags.bool, color: 'var(--color-code-bool)' },
  { tag: [tags.string, tags.character, tags.special(tags.string)], color: 'var(--color-code-string)' },
  { tag: [tags.number, tags.integer, tags.float], color: 'var(--color-code-number)' },
  { tag: tags.operator, color: 'var(--color-code-operator)' },
  { tag: [tags.punctuation, tags.separator, tags.bracket], color: 'var(--color-code-punctuation)' },
  { tag: [tags.meta, tags.labelName], color: 'var(--color-code-meta)' },
  { tag: tags.invalid, color: 'var(--color-error)' },
]);

export function CodeEditor({
  value,
  mode,
  lineWrapping,
  jumpTarget,
  searchPanelVisible,
  onChange,
  onSearchPanelVisibleChange,
}: CodeEditorProps) {
  const { lang } = useI18n();
  const hostRef = useRef<HTMLDivElement | null>(null);
  const viewRef = useRef<EditorView | null>(null);
  const onChangeRef = useRef(onChange);
  const onSearchPanelVisibleChangeRef = useRef(onSearchPanelVisibleChange);
  const applyingExternalChange = useRef(false);
  const searchPanelVisibleRef = useRef(searchPanelVisible);
  const languageCompartment = useRef(new Compartment());
  const lineWrappingCompartment = useRef(new Compartment());
  const phrasesCompartment = useRef(new Compartment());

  useEffect(() => {
    onChangeRef.current = onChange;
  }, [onChange]);

  useEffect(() => {
    onSearchPanelVisibleChangeRef.current = onSearchPanelVisibleChange;
  }, [onSearchPanelVisibleChange]);

  useEffect(() => {
    const host = hostRef.current;
    if (!host) {
      return;
    }

    const view = new EditorView({
      doc: value,
      parent: host,
      extensions: [
        basicSetup,
        Prec.highest(
          keymap.of([
            {
              key: 'Mod-f',
              run: (view) => {
                openCodeMirrorSearchPanel(view, hostRef.current);
                searchPanelVisibleRef.current = true;
                onSearchPanelVisibleChangeRef.current(true);
                return true;
              },
            },
            { key: 'Mod-z', run: undo },
            { key: 'Shift-Mod-z', run: redo },
            { key: 'Mod-y', run: redo },
          ]),
        ),
        keymap.of([indentWithTab]),
        syntaxHighlighting(rtonHighlightStyle),
        languageCompartment.current.of(languageExtension(mode)),
        lineWrappingCompartment.current.of(lineWrappingExtension(lineWrapping)),
        phrasesCompartment.current.of(EditorState.phrases.of(codeMirrorPhrases(lang))),
        EditorView.contentAttributes.of({ 'aria-label': `${mode.toUpperCase()} editor` }),
        EditorView.updateListener.of((update: ViewUpdate) => {
          if (update.docChanged && !applyingExternalChange.current) {
            onChangeRef.current(update.state.doc.toString());
          }

          const nextSearchPanelVisible = isSearchPanelOpen(update.state);
          if (nextSearchPanelVisible !== searchPanelVisibleRef.current) {
            searchPanelVisibleRef.current = nextSearchPanelVisible;
            onSearchPanelVisibleChangeRef.current(nextSearchPanelVisible);
          }
        }),
        editorTheme,
      ],
    });

    if (searchPanelVisible) {
      openSearchPanel(view);
    }

    viewRef.current = view;
    const unregisterShortcuts = registerEditorShortcutOwner({
      element: host,
      handleShortcut: (kind) => {
        const currentView = viewRef.current;
        if (!currentView) {
          return;
        }

        if (kind === 'find') {
          openCodeMirrorSearchPanel(currentView, hostRef.current);
          searchPanelVisibleRef.current = true;
          onSearchPanelVisibleChangeRef.current(true);
        } else if (kind === 'undo') {
          undo(currentView);
        } else {
          redo(currentView);
        }
      },
      shouldHandleShortcut: (kind, event) => {
        if (kind === 'find') {
          return true;
        }

        const target = event.target;
        return !(target instanceof HTMLElement && target.closest('.cm-panel.cm-search'));
      },
    });

    return () => {
      unregisterShortcuts();
      view.destroy();
      viewRef.current = null;
    };
  }, []);

  useEffect(() => {
    const view = viewRef.current;
    if (!view) {
      return;
    }

    const current = view.state.doc.toString();
    if (current === value) {
      return;
    }

    applyingExternalChange.current = true;
    try {
      view.dispatch({
        changes: { from: 0, to: view.state.doc.length, insert: value },
      });
    } finally {
      applyingExternalChange.current = false;
    }
  }, [value]);

  useEffect(() => {
    const view = viewRef.current;
    if (!view) {
      return;
    }

    view.dispatch({
      effects: languageCompartment.current.reconfigure(languageExtension(mode)),
    });
  }, [mode]);

  useEffect(() => {
    const view = viewRef.current;
    if (!view) {
      return;
    }

    view.dispatch({
      effects: lineWrappingCompartment.current.reconfigure(lineWrappingExtension(lineWrapping)),
    });
  }, [lineWrapping]);

  useEffect(() => {
    const view = viewRef.current;
    if (!view) {
      return;
    }

    const searchPanelWasOpen = isSearchPanelOpen(view.state);
    view.dispatch({
      effects: phrasesCompartment.current.reconfigure(EditorState.phrases.of(codeMirrorPhrases(lang))),
    });

    if (searchPanelWasOpen) {
      closeSearchPanel(view);
      openSearchPanel(view);
      searchPanelVisibleRef.current = true;
      onSearchPanelVisibleChangeRef.current(true);
    }
  }, [lang]);

  useEffect(() => {
    const view = viewRef.current;
    if (!view) {
      return;
    }

    searchPanelVisibleRef.current = searchPanelVisible;
    const currentSearchPanelVisible = isSearchPanelOpen(view.state);
    if (currentSearchPanelVisible === searchPanelVisible) {
      return;
    }

    if (searchPanelVisible) {
      openSearchPanel(view);
    } else {
      closeSearchPanel(view);
    }
  }, [searchPanelVisible]);

  useEffect(() => {
    const view = viewRef.current;
    if (!view || !jumpTarget) {
      return;
    }

    const safeLineNumber = Math.min(Math.max(1, jumpTarget.line), view.state.doc.lines);
    const line = view.state.doc.line(safeLineNumber);
    const column = Math.min(Math.max(0, jumpTarget.column ?? 0), line.length);
    const pos = line.from + column;
    view.dispatch({
      selection: { anchor: pos },
      effects: EditorView.scrollIntoView(pos, { y: 'center' }),
    });
    view.focus();
  }, [jumpTarget]);

  return <div ref={hostRef} className="h-full min-h-0 w-full overflow-hidden" />;
}

function openCodeMirrorSearchPanel(view: EditorView, host: HTMLElement | null) {
  openSearchPanel(view);
  requestAnimationFrame(() => {
    host?.querySelector<HTMLInputElement>('.cm-panel.cm-search input[name="search"]')?.focus();
  });
}

function languageExtension(mode: EditorMode): Extension {
  if (mode === 'json') {
    return json();
  }
  if (mode === 'yaml') {
    return yaml();
  }
  return StreamLanguage.define(toml);
}

function lineWrappingExtension(enabled: boolean): Extension {
  return enabled ? EditorView.lineWrapping : [];
}

function codeMirrorPhrases(lang: string): Record<string, string> {
  if (lang !== 'zh-CN') {
    return CODE_MIRROR_EN_PHRASES;
  }
  return CODE_MIRROR_ZH_CN_PHRASES;
}

const CODE_MIRROR_EN_PHRASES: Record<string, string> = {};

const CODE_MIRROR_ZH_CN_PHRASES: Record<string, string> = {
  Find: '查找',
  Replace: '替换',
  next: '下一个',
  previous: '上一个',
  all: '全选',
  'match case': '区分大小写',
  regexp: '正则',
  'by word': '整词',
  replace: '替换',
  'replace all': '全部替换',
  close: '关闭',
  'current match': '当前匹配',
  'on line': '位于第',
  'Go to line': '转到行',
  go: '转到',
  'replaced match on line $': '已替换第 $ 行的匹配',
  'replaced $ matches': '已替换 $ 个匹配',
};
