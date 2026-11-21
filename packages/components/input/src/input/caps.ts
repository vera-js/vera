import { announce } from '@vera-hooks/announce';

/**
 * **The caps-lock hint, while `caps-lock-hint` is set**: a `keydown` and a `keyup` listener on the input (only with the
 * option), reading the key event's own `getModifierState('CapsLock')`, the one reliable source (no event says when
 * Caps Lock changes outside the field). While it is on, the hint part shows; the first time it is seen on during a
 * focus, `message` (default "Caps Lock is on") is announced, once, never again until the input is left and focused
 * again. Never visual only. Returns the release.
 */
export const capsHint = (input: HTMLInputElement, message: string): (() => void) => {
  const hint = input.ownerDocument.createElement('span');
  hint.setAttribute('data-vera-part', 'caps-lock');
  hint.setAttribute('data-vera-input', '');
  hint.textContent = message;
  hint.hidden = true;
  let spoken = false;
  const onKey = (event: KeyboardEvent): void => {
    if (typeof event.getModifierState !== 'function') return;
    const on = event.getModifierState('CapsLock');
    hint.hidden = !on;
    if (on && !spoken) {
      spoken = true;
      announce(input, message);
    }
  };
  const onBlur = (): void => {
    spoken = false;
    hint.hidden = true;
  };
  input.after(hint);
  input.addEventListener('keydown', onKey);
  input.addEventListener('keyup', onKey);
  input.addEventListener('blur', onBlur);
  return () => {
    input.removeEventListener('keydown', onKey);
    input.removeEventListener('keyup', onKey);
    input.removeEventListener('blur', onBlur);
    hint.remove();
  };
};
