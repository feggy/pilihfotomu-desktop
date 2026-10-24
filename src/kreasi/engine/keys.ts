/** Inputs that take typed text — the keyboard is theirs, shortcuts included. */
const TEXT_INPUTS = new Set(['text', 'search', 'email', 'url', 'tel', 'password', 'number']);

/**
 * Whether a key press belongs to a field being typed in. A slider, a switch or
 * a button that was just used keeps the focus but not the keyboard: Ctrl/⌘ + Z
 * and the rest still work on the collage.
 */
export function isTyping(target: EventTarget | null): boolean {
  const el = target as HTMLElement | null;
  if (!el?.closest) return false;
  if (el.closest('textarea, select, [contenteditable="true"], [contenteditable=""]')) return true;
  const input = el.closest('input');
  return Boolean(input && TEXT_INPUTS.has(input.type));
}
