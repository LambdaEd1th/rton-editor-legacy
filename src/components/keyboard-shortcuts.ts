export function isFindShortcut(event: globalThis.KeyboardEvent) {
  return (event.metaKey || event.ctrlKey) && !event.altKey && event.key.toLowerCase() === 'f';
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
