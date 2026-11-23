/**
 * **`<vera-dialog>`'s sheet**, adopted by the element into its root (`adoptOwnSheet`, menu's and tabs' way). Every rule
 * is keyed on our mark on the author's own `<dialog>` (`[data-vera-part="dialog"]` inside `[data-vera-dialog]`) and is
 * zero specificity, so a page's own rule wins; `data-vera-look="none"` on the host drops the look and keeps the scroll
 * lock and the placement.
 *
 * **Two sheets.** `LOCK` (the page's scroll lock) is adopted into the DOCUMENT: it styles the root element, which a sheet
 * in a shadow root cannot reach, so a dialog inside another component's shadow root still locks the page. `LOOK` is
 * adopted into the host's own root, beside the dialog it styles.
 *
 * **Placement** is the host's `placement` attribute, read by CSS alone: `end` and `start` dock the dialog to that inline
 * edge at full block size, `bottom` to the block end at full inline size (a sheet), each sliding in. **Scroll lock**: the
 * page does not scroll while a modal is open (`:has(dialog:modal)` on the root), keeps its scrollbar's room when it had a
 * scrollbar (the element marks the root `data-vera-scrolled` at open; a gutter on a page that never scrolled would move
 * it), and the dialog's own scrolling does not chain to it. **Entry** fades (or slides) in by `@starting-style` on
 * every engine; the **exit** runs where the engine can transition `display` and `overlay`, and is instant elsewhere
 * (Firefox). Reduced motion: no animation.
 */
export const SHEET = '_$veraDialog$';
/** The document's sheet: the scroll lock. */
export const LOCK_SHEET = '_$veraDialogLock$';

const DIALOG = ':where([data-vera-dialog]) > :where(dialog[data-vera-part="dialog"])';
const look = (selector: string): string => `:where([data-vera-dialog]:not([data-vera-look="none"])) > ${selector}`;
const D = ':where(dialog[data-vera-part="dialog"])';
const at = (placement: string, rest = ''): string => `:where([data-vera-dialog][placement="${placement}"]) > ${D}${rest}`;

/** `:has` crosses no shadow boundary, so the lock keys on the root's own mark, set while a dialog is open. */
export const LOCK =
  ':where(:root[data-vera-locked]){overflow:hidden}' + ':where(:root[data-vera-locked][data-vera-scrolled]){scrollbar-gutter:stable}';

export const LOOK =
  `${DIALOG}{overscroll-behavior:contain}` +
  `${look(D)}{box-sizing:border-box;max-inline-size:min(32rem,calc(100vw - 32px));max-block-size:calc(100dvh - 32px);` +
  'padding:24px;border:1px solid var(--vera-border,#d4d4d8);border-radius:var(--vera-radius,6px);' +
  'background:var(--vera-bg,#fff);color:var(--vera-fg,#18181b);box-shadow:0 16px 48px rgb(0 0 0/.18)}' +
  `${look(`${D}::backdrop`)}{background:rgb(0 0 0/.4)}` +
  `${at('end')},${at('start')}{margin-block:0;max-block-size:none;block-size:100dvh;border-radius:0}` +
  `${at('end')}{margin-inline:auto 0}` +
  `${at('start')}{margin-inline:0 auto}` +
  `${at('bottom')}{margin-block:auto 0;margin-inline:0;max-inline-size:none;inline-size:100%;border-end-start-radius:0;border-end-end-radius:0}` +
  '@media (prefers-reduced-motion:no-preference){' +
  `${look(D)},${look(`${D}::backdrop`)}{transition:opacity 160ms ease,translate 160ms ease,display 160ms allow-discrete,overlay 160ms allow-discrete}` +
  `${look(`${D}:not([open])`)},${look(`${D}:not([open])::backdrop`)}{opacity:0}` +
  `@starting-style{${look(`${D}[open]`)},${look(`${D}[open]::backdrop`)}{opacity:0}}` +
  `${at('end', ':not([open])')}{translate:100% 0}` +
  `${at('start', ':not([open])')}{translate:-100% 0}` +
  `${at('bottom', ':not([open])')}{translate:0 100%}` +
  `@starting-style{${at('end', '[open]')}{translate:100% 0}${at('start', '[open]')}{translate:-100% 0}${at('bottom', '[open]')}{translate:0 100%}}}`;
