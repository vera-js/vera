/**
 * **Reveal, while `reveal` is set on a password input**: a real button after the input, in the tab order, named by
 * `reveal-label` (default "Show password") with `aria-pressed` for its state, that switches the input between
 * `password` and `text`. The input is a password field again before anything could keep its text: on the form's
 * `submit` (before the browser builds what it saves, so form history and the save-password prompt see a password),
 * on `pagehide` (so the back-forward cache keeps a hidden one), and when reveal ends. Returns the release.
 */
export const revealing = (input: HTMLInputElement, label: string): (() => void) => {
  const doc = input.ownerDocument;
  const win = doc.defaultView;
  const button = doc.createElement('button');
  button.type = 'button';
  button.setAttribute('data-vera-part', 'reveal');
  button.setAttribute('aria-label', label);
  button.setAttribute('aria-pressed', 'false');
  const set = (shown: boolean): void => {
    input.type = shown ? 'text' : 'password';
    button.setAttribute('aria-pressed', String(shown));
  };
  const hide = (): void => {
    if (input.type !== 'password') set(false);
  };
  const onClick = (): void => {
    set(input.type === 'password');
    /** The caret stays where the user left it: a type switch keeps the selection on every engine, focus only moves. */
    input.focus();
  };
  const form = input.form;
  input.after(button);
  button.addEventListener('click', onClick);
  form?.addEventListener('submit', hide);
  win?.addEventListener('pagehide', hide);
  return () => {
    hide();
    button.removeEventListener('click', onClick);
    form?.removeEventListener('submit', hide);
    win?.removeEventListener('pagehide', hide);
    button.remove();
  };
};
