export function isFindShortcut(event: globalThis.KeyboardEvent) {
  return hasPrimaryModifier(event) && !event.shiftKey && matchesKey(event, 'f', 'KeyF');
}

export function isUndoShortcut(event: globalThis.KeyboardEvent) {
  return hasPrimaryModifier(event) && !event.shiftKey && matchesKey(event, 'z', 'KeyZ');
}

export function isRedoShortcut(event: globalThis.KeyboardEvent) {
  return hasPrimaryModifier(event) && (matchesKey(event, 'y', 'KeyY') || (event.shiftKey && matchesKey(event, 'z', 'KeyZ')));
}

export function eventTargetsElement(element: HTMLElement | null, event: Event) {
  if (!element) {
    return false;
  }

  const target = event.target;
  if (target instanceof Node && element.contains(target)) {
    return true;
  }

  const activeElement = element.ownerDocument.activeElement;
  return activeElement instanceof Node && element.contains(activeElement);
}

function hasPrimaryModifier(event: globalThis.KeyboardEvent) {
  return (event.metaKey || event.ctrlKey) && !event.altKey;
}

function matchesKey(event: globalThis.KeyboardEvent, key: string, code: string) {
  return event.key.toLowerCase() === key || event.code === code;
}
