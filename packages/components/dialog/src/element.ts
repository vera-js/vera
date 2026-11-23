/**
 * **<vera-dialog>: its options and its setup.** Never calls `define`: `register.ts` does, so importing the `./element`
 * entry registers nothing.
 *
 * A modal dialog over the author's own `<dialog>`, wired in place and left in light DOM, so a `<form method="dialog">`
 * inside closes it with a `returnValue` and the platform does the modal work: the top layer, inert outside, Escape, the
 * initial focus (`autofocus` decides it), and focus back to the opener. Opened by the platform's own invokers (`<button
 * commandfor command="show-modal">`, anywhere on the page, no script), by a direct child `slot="trigger"` button the
 * element wires the same way, or by the host's `open` attribute, which binds both ways: a user close removes it, so a
 * framework's bound state stays in step. Every user close goes through the platform's cancelable `cancel`.
 */
import { effect, isServer } from '@verajs/core';
import { adoptOwnSheet, diagnostic } from '@verajs/shared-utils';
import { PROSE } from './diagnostics.js';
import { LOCK, LOCK_SHEET, LOOK, SHEET } from './dialog/styles.js';

/** The tag and the element's declared attributes, handed to core's `define` by `register.ts`. */
export const options = { tag: 'vera-dialog', attributes: ['open'], ownsChildren: true } as const;

/** What `define` hands the setup: the element, with its declared attribute as a prop. */
interface DialogHost extends HTMLElement {
  open: string | null;
}

/** Ids from the counter the library's hooks share (`vera.uid`), so two copies never mint the same. */
const uid: { n: number } = ((globalThis as Record<symbol, unknown>)[Symbol.for('vera.uid')] ??= { n: 0 }) as { n: number };

/** Whether the engine has the platform's invokers, `closedby`, and `requestClose()`. */
const INVOKERS = typeof HTMLButtonElement !== 'undefined' && 'commandForElement' in HTMLButtonElement.prototype;
const CLOSEDBY = typeof HTMLDialogElement !== 'undefined' && 'closedBy' in HTMLDialogElement.prototype;
/**
 * Whether the DOM can show a modal at all: every engine can; jsdom (25) has `<dialog>` with no `showModal` or `close`,
 * and an app's own jsdom tests must still mount the element, so the open state is then left to the attribute alone.
 */
const MODAL = typeof HTMLDialogElement !== 'undefined' && typeof HTMLDialogElement.prototype.showModal === 'function';
const REQUEST = typeof HTMLDialogElement !== 'undefined' && typeof HTMLDialogElement.prototype.requestClose === 'function';

/**
 * A user close: the platform's `requestClose()`, which fires a cancelable `cancel` first. Where it is missing, the same
 * contract by hand: a cancelable `cancel`, then `close()` unless it was canceled.
 */
const ask = (dialog: HTMLDialogElement): void => {
  if (REQUEST) dialog.requestClose();
  else if (dialog.dispatchEvent(new Event('cancel', { cancelable: true }))) dialog.close();
};

/** A point inside the dialog's own box (its border box: the backdrop is outside it, its scrollbar inside). */
const inside = (dialog: Element, event: PointerEvent): boolean => {
  const box = dialog.getBoundingClientRect();
  return event.clientX >= box.left && event.clientX <= box.right && event.clientY >= box.top && event.clientY <= box.bottom;
};

export const setup = (host: DialogHost) => {
  host.setAttribute('data-vera-dialog', '');
  effect(() => {
    adoptOwnSheet(host, SHEET, LOOK);
    adoptOwnSheet(host.ownerDocument.documentElement, LOCK_SHEET, LOCK);
  }, { timing: 'layout' });

  const dialog = host.querySelector<HTMLDialogElement>(':scope > dialog');
  if (dialog === null) {
    if (__DEV__) console.warn(diagnostic('dialog', '<vera-dialog>', 'dialog-no-dialog', __DEV__ && PROSE['dialog-no-dialog']()));
    return;
  }
  const id = `vd${++uid.n}`;
  if (!dialog.id) dialog.id = id;
  dialog.setAttribute('data-vera-part', 'dialog');
  const alert = dialog.getAttribute('role') === 'alertdialog';

  /** Named by its own label, else by its first heading; described by a part marked `description`. */
  if (!dialog.hasAttribute('aria-label') && !dialog.hasAttribute('aria-labelledby')) {
    const title = dialog.querySelector('h1, h2, h3, h4, h5, h6, [data-vera-part="title"]');
    if (title !== null) {
      if (!title.id) title.id = `${id}-title`;
      dialog.setAttribute('aria-labelledby', title.id);
    } else if (__DEV__) console.warn(diagnostic('dialog', '<vera-dialog>', 'dialog-no-label', __DEV__ && PROSE['dialog-no-label']()));
  }
  const description = dialog.querySelector('[data-vera-part="description"]');
  if (description !== null && !dialog.hasAttribute('aria-describedby')) {
    if (!description.id) description.id = `${id}-description`;
    dialog.setAttribute('aria-describedby', description.id);
  }
  if (__DEV__ && alert) {
    if (dialog.querySelector('[autofocus]') === null)
      console.warn(diagnostic('dialog', '<vera-dialog>', 'dialog-alert-no-autofocus', __DEV__ && PROSE['dialog-alert-no-autofocus']()));
    if (description === null && !dialog.hasAttribute('aria-describedby'))
      console.warn(diagnostic('dialog', '<vera-dialog>', 'dialog-alert-no-description', __DEV__ && PROSE['dialog-alert-no-description']()));
  }

  /** The trigger: the platform's invoker where the engine has it (it opens before any script), else a click. */
  const trigger = host.querySelector<HTMLButtonElement>(':scope > [slot="trigger"]');
  if (trigger !== null) {
    trigger.setAttribute('aria-haspopup', 'dialog');
    if (!trigger.hasAttribute('commandfor')) trigger.setAttribute('commandfor', dialog.id);
    if (!trigger.hasAttribute('command')) trigger.setAttribute('command', 'show-modal');
  }
  /** Light dismiss on request, never for an alert dialog: `closedby` where the engine has it. */
  const outside = host.getAttribute('dismiss') === 'outside' && !alert;
  if (outside && CLOSEDBY) dialog.setAttribute('closedby', 'any');

  if (isServer() || !MODAL) return;


  effect(() => {
    const doc = host.ownerDocument;
    /** Opened by a click on the trigger where the engine has no invokers. */
    const onTrigger = () => {
      if (!dialog.open) dialog.showModal();
    };
    /** The state, back to the host: an invoker's open sets `open`, any close removes it. */
    const onToggle = (event: Event) => {
      if ((event as ToggleEvent).newState === 'open') {
        if (host.open === null) host.setAttribute('open', '');
      } else if (!dialog.open && host.open !== null) host.removeAttribute('open');
    };
    /**
     * Before it opens (`beforetoggle` is synchronous, so the lock and the mark land in the same style): the page keeps
     * its scrollbar's room while locked only when it had one, since a gutter on a page that never scrolled moves its
     * content (7.6 px on Chromium with classic scrollbars, measured), so one read marks the root.
     */
    const onBefore = (event: Event) => {
      if ((event as ToggleEvent).newState !== 'open') return;
      const root = doc.documentElement;
      root.toggleAttribute('data-vera-scrolled', root.scrollHeight > root.clientHeight);
      root.toggleAttribute('data-vera-locked', true);
    };
    /**
     * After a close: the page's lock goes once no modal of ours is open, and when the platform found no opener to return
     * to, the trigger takes focus. At `close` that reads as focus on the body (Firefox) or still inside the closed dialog
     * (Chromium and WebKit, measured), so both count. Chosen: an app-opened dialog (the host's `open`, focus on the
     * body) also returns focus to the trigger when there is one. A `close` that arrives while the dialog is open again
     * (queued before a reconnect reopened it) is stale and changes nothing.
     */
    const onClose = () => {
      if (dialog.open) return;
      if (doc.querySelector('[data-vera-dialog] > dialog:modal') === null) doc.documentElement.removeAttribute('data-vera-locked');
      if (host.open !== null) host.removeAttribute('open');
      const active = doc.activeElement;
      if (trigger !== null && trigger.isConnected && (active === null || active === doc.body || dialog.contains(active)))
        trigger.focus({ preventScroll: true });
    };
    /**
     * Light dismiss where the engine has no `closedby`: the platform's rule, a press AND its release both outside the
     * dialog's box (a drag out of the dialog does not close it, nor does its own scrollbar).
     */
    let pressed = false;
    const onDown = (event: PointerEvent) => {
      pressed = dialog.open && !inside(dialog, event);
    };
    const onUp = (event: PointerEvent) => {
      if (pressed && dialog.open && !inside(dialog, event)) ask(dialog);
      pressed = false;
    };
    const fallback = outside && !CLOSEDBY;
    if (trigger !== null && !INVOKERS) trigger.addEventListener('click', onTrigger);
    dialog.addEventListener('beforetoggle', onBefore);
    dialog.addEventListener('toggle', onToggle);
    dialog.addEventListener('close', onClose);
    if (fallback) {
      dialog.addEventListener('pointerdown', onDown);
      dialog.addEventListener('pointerup', onUp);
    }
    return () => {
      trigger?.removeEventListener('click', onTrigger);
      dialog.removeEventListener('beforetoggle', onBefore);
      dialog.removeEventListener('toggle', onToggle);
      dialog.removeEventListener('close', onClose);
      dialog.removeEventListener('pointerdown', onDown);
      dialog.removeEventListener('pointerup', onUp);
      /** Removed while open, it fires no close (measured), so the page's lock goes here unless another modal of ours holds it. */
      if (doc.querySelector('[data-vera-dialog] > dialog:modal') === null) doc.documentElement.removeAttribute('data-vera-locked');
    };
  });

  /**
   * After the listeners, so their `beforetoggle` sees this effect's opens: at load and at a reconnect the lock is set.
   */
  effect(() => {
    /**
     * The host's `open`: written by the app, it opens or closes; a user's open or close writes it back. A move keeps it:
     * an open modal removed and appended again stays `open` but is no longer modal on every engine (no `close` fires;
     * measured on Chromium, Firefox and WebKit), so this effect, run again on the reconnect, makes it modal again. The
     * app sees that as one `close` and one `toggle` pair at the reconnect, not at the removal.
     */
    const wanted = host.open !== null;
    if (wanted && dialog.open && !dialog.matches(':modal')) dialog.close();
    if (wanted && !dialog.open) dialog.showModal();
    else if (!wanted && dialog.open) dialog.close();
  });
};
