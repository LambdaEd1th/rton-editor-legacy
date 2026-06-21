export function isFindShortcut(event: globalThis.KeyboardEvent) {
  return hasPrimaryModifier(event) && !event.shiftKey && matchesKey(event, 'f', 'KeyF');
}

export function isUndoShortcut(event: globalThis.KeyboardEvent) {
  return hasPrimaryModifier(event) && !event.shiftKey && matchesKey(event, 'z', 'KeyZ');
}

export function isRedoShortcut(event: globalThis.KeyboardEvent) {
  return hasPrimaryModifier(event) && (matchesKey(event, 'y', 'KeyY') || (event.shiftKey && matchesKey(event, 'z', 'KeyZ')));
}

export type EditorShortcutKind = 'find' | 'undo' | 'redo';

export type EditorShortcutOwner = {
  element: HTMLElement;
  handleShortcut: (kind: EditorShortcutKind) => void;
  shouldHandleShortcut?: (kind: EditorShortcutKind, event: Event) => boolean;
};

let activeEditorShortcutOwner: EditorShortcutOwner | null = null;
let installedDocument: Document | null = null;

export function registerEditorShortcutOwner(owner: EditorShortcutOwner) {
  ensureEditorShortcutListeners(owner.element.ownerDocument);

  const activate = () => {
    activeEditorShortcutOwner = owner;
  };

  owner.element.addEventListener('focusin', activate, true);
  owner.element.addEventListener('pointerdown', activate, true);
  activate();

  return () => {
    owner.element.removeEventListener('focusin', activate, true);
    owner.element.removeEventListener('pointerdown', activate, true);
    if (activeEditorShortcutOwner === owner) {
      activeEditorShortcutOwner = null;
    }
  };
}

function hasPrimaryModifier(event: globalThis.KeyboardEvent) {
  return (event.metaKey || event.ctrlKey) && !event.altKey;
}

function matchesKey(event: globalThis.KeyboardEvent, key: string, code: string) {
  return event.key.toLowerCase() === key || event.code === code;
}

function ensureEditorShortcutListeners(document: Document) {
  if (installedDocument === document) {
    return;
  }

  installedDocument = document;
  document.defaultView?.addEventListener('keydown', handleEditorShortcutKeyDown, true);
  document.addEventListener('keydown', handleEditorShortcutKeyDown, true);
  document.addEventListener('beforeinput', handleEditorShortcutBeforeInput, true);
}

function handleEditorShortcutKeyDown(event: globalThis.KeyboardEvent) {
  if (event.defaultPrevented) {
    return;
  }

  const kind = getKeyboardShortcutKind(event);
  if (!kind || !canHandleEditorShortcut(kind, event)) {
    return;
  }

  event.preventDefault();
  event.stopPropagation();
  event.stopImmediatePropagation();
  activeEditorShortcutOwner?.handleShortcut(kind);
}

function handleEditorShortcutBeforeInput(event: InputEvent) {
  if (event.defaultPrevented) {
    return;
  }

  const kind = event.inputType === 'historyUndo' ? 'undo' : event.inputType === 'historyRedo' ? 'redo' : null;
  if (!kind || !canHandleEditorShortcut(kind, event)) {
    return;
  }

  event.preventDefault();
  event.stopPropagation();
  event.stopImmediatePropagation();
  activeEditorShortcutOwner?.handleShortcut(kind);
}

function getKeyboardShortcutKind(event: globalThis.KeyboardEvent): EditorShortcutKind | null {
  if (isFindShortcut(event)) {
    return 'find';
  }
  if (isUndoShortcut(event)) {
    return 'undo';
  }
  if (isRedoShortcut(event)) {
    return 'redo';
  }
  return null;
}

function canHandleEditorShortcut(kind: EditorShortcutKind, event: Event) {
  const owner = activeEditorShortcutOwner;
  if (!owner) {
    return false;
  }

  const target = event.target;
  const targetInsideOwner = target instanceof Node && owner.element.contains(target);
  if (!targetInsideOwner && isEditableTarget(target)) {
    return false;
  }

  if (!targetInsideOwner) {
    const activeElement = owner.element.ownerDocument.activeElement;
    const activeInsideOwner = activeElement instanceof Node && owner.element.contains(activeElement);
    if (!activeInsideOwner && activeElement && isEditableTarget(activeElement)) {
      return false;
    }
  }

  return owner.shouldHandleShortcut?.(kind, event) ?? true;
}

function isEditableTarget(target: EventTarget | null) {
  if (!(target instanceof HTMLElement)) {
    return false;
  }

  const tagName = target.tagName;
  return (
    tagName === 'INPUT' ||
    tagName === 'TEXTAREA' ||
    tagName === 'SELECT' ||
    target.isContentEditable
  );
}
