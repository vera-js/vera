/**
 * **<vera-menu>: its options and its setup.** Never calls `define`: `register.ts` does, so importing the `./element`
 * entry registers nothing.
 *
 * An action menu over the author's own markup, wired in place. A direct child `<button slot="trigger">` opens it (or, with
 * `opener="context"`, a `contextmenu` on the `slot="target"` child); a direct child `slot="menu"` holds the items:
 * `<button>`s, `<a href>`s, `<hr>`s and groups. The menu is the platform's `popover="auto"` (top layer, light dismiss,
 * Escape), placed under its trigger by CSS anchor positioning with flips, and the trigger opens it by `popovertarget`.
 * Served with `popover` and `popovertarget` already written, it opens and closes before any script runs.
 *
 * Focus follows how it opened: a key (or a screen reader's click, `detail === 0`) focuses the first item, ArrowUp the
 * last; a pointer focuses the menu itself, and the first arrow then moves to an item. The arrows, Home and End move one
 * tab stop (`@vera-hooks/roving-focus`), and typing jumps (`@vera-hooks/typeahead`). A natively `disabled` item is
 * skipped; an `aria-disabled="true"` item is reachable and does nothing (the APG). Choosing an item: its own `click` runs
 * first (the author's handler), then a bubbling, cancelable `menuaction` on the host (canceling keeps the menu open; it
 * cannot undo the click). Enter and a pointer close the menu; Space on a checkbox or radio item toggles it and keeps the
 * menu open (React Aria's split, the APG's), and an item marked `data-keep-open` always stays.
 */
import { effect } from '@verajs/core';
import { adoptOwnSheet, diagnostic } from '@verajs/shared-utils';
import { rovingFocus } from '@vera-hooks/roving-focus';
import { createTypeahead } from '@vera-hooks/typeahead';
import { PROSE } from './diagnostics.js';
import { LOOK, SHEET } from './menu/styles.js';

/** The tag and the element's declared attributes, handed to core's `define` by `register.ts`. */
export const options = { tag: 'vera-menu', attributes: ['opener'], ownsChildren: true } as const;

/** What `define` hands the setup: the element, with its declared attribute as a prop. */
interface MenuHost extends HTMLElement {
  opener: string | null;
}

/** Why an item was chosen. */
export type MenuActionReason = 'pointer' | 'keyboard';
/** `menuaction`'s detail: the item, its `value` (else its text), its checked state after the choice where it has one. */
export type MenuActionDetail = { item: Element; value: string; checked: boolean | null; reason: MenuActionReason };

/** Ids and anchor names from the counter the library's hooks share (`vera.uid`), so two copies never mint the same. */
const uid: { n: number } = ((globalThis as Record<symbol, unknown>)[Symbol.for('vera.uid')] ??= { n: 0 }) as { n: number };

const ITEM = 'button, a[href], [role="menuitem"], [role="menuitemcheckbox"], [role="menuitemradio"]';
const CHECKABLE = /^menuitem(checkbox|radio)$/;
/** An item's text for typeahead and for `value`: its own words, a shortcut's `<kbd>` left out. */
const words = (item: Element): string => {
  let text = '';
  for (const node of item.childNodes) if (!(node.nodeType === 1 && /^(kbd|vera-kbd)$/.test((node as Element).localName))) text += node.textContent ?? '';
  return text.trim();
};
const inert = (item: Element): boolean => item.getAttribute('aria-disabled') === 'true';

/** Modifier words, in any case, to ARIA's names; `Mod` is Meta on Apple platforms and Control elsewhere. */
const MODIFIERS: Record<string, string> = { ctrl: 'Control', control: 'Control', alt: 'Alt', option: 'Alt', shift: 'Shift', meta: 'Meta', cmd: 'Meta', command: 'Meta', win: 'Meta' };
/**
 * A shown shortcut in `aria-keyshortcuts`' form ("Control+Shift+K"), or null when it does not parse as words: glyphs
 * such as ⌘ are not guessed. The last part is one character (upper-cased), a function key, or a key name of one word.
 */
const shortcut = (text: string, mac: boolean): string | null => {
  const parts = text.trim().split(/\s*\+\s*/);
  const key = parts.pop() ?? '';
  const said: string[] = [];
  for (const part of parts) {
    const word = part.toLowerCase();
    const name = word === 'mod' ? (mac ? 'Meta' : 'Control') : MODIFIERS[word];
    if (name === undefined) return null;
    said.push(name);
  }
  if (/^[!-~]$/.test(key)) said.push(key.toUpperCase());
  else if (/^(F([1-9]|1\d|2[0-4])|[A-Z][a-z]+([A-Z][a-z]+)*)$/.test(key)) said.push(key);
  else return null;
  return said.join('+');
};

export const setup = (host: MenuHost) => {
  host.setAttribute('data-vera-menu', '');
  effect(() => adoptOwnSheet(host, SHEET, LOOK), { timing: 'layout' });

  const menu = host.querySelector<HTMLElement>(':scope > [slot="menu"]');
  if (menu === null) {
    if (__DEV__) console.warn(diagnostic('menu', '<vera-menu>', 'menu-no-list', __DEV__ && PROSE['menu-no-list']()));
    return;
  }
  const context = host.opener === 'context';
  const trigger = context ? null : host.querySelector<HTMLElement>(':scope > [slot="trigger"]');
  const target = context ? host.querySelector<HTMLElement>(':scope > [slot="target"]') : null;
  if (context ? target === null : trigger === null) {
    if (__DEV__) {
      if (context) console.warn(diagnostic('menu', '<vera-menu>', 'menu-no-target', __DEV__ && PROSE['menu-no-target']()));
      else console.warn(diagnostic('menu', '<vera-menu>', 'menu-no-trigger', __DEV__ && PROSE['menu-no-trigger']()));
    }
    return;
  }

  const id = `vm${++uid.n}`;
  const name = `--_vera-menu-${id}`;
  if (!menu.id) menu.id = `${id}-menu`;
  menu.setAttribute('role', 'menu');
  menu.setAttribute('data-vera-part', 'menu');
  menu.setAttribute('data-vera-menu', '');
  menu.setAttribute('tabindex', '-1');
  if (!menu.hasAttribute('popover')) menu.setAttribute('popover', 'auto');
  menu.removeAttribute('hidden');
  menu.style.setProperty('--_vera-menu-anchor', name);

  /** Context mode: one 0×0 anchor of ours, made once and moved to the pointer at each open. */
  let point: HTMLElement | null = null;
  if (trigger !== null) {
    if (!trigger.id) trigger.id = `${id}-trigger`;
    trigger.setAttribute('aria-haspopup', 'menu');
    trigger.setAttribute('aria-controls', menu.id);
    trigger.setAttribute('popovertarget', menu.id);
    trigger.style.setProperty('anchor-name', name);
    if (!menu.hasAttribute('aria-label')) menu.setAttribute('aria-labelledby', trigger.id);
  } else {
    point = host.ownerDocument.createElement('span');
    point.setAttribute('aria-hidden', 'true');
    point.setAttribute('data-vera-part', 'point');
    point.style.cssText = `position:fixed;inline-size:0;block-size:0;anchor-name:${name}`;
    host.append(point);
    if (__DEV__ && !menu.hasAttribute('aria-label') && !menu.hasAttribute('aria-labelledby'))
      console.warn(diagnostic('menu', '<vera-menu>', 'menu-no-label', __DEV__ && PROSE['menu-no-label']()));
  }

  /** The items, roles set: `menuitem` unless the author wrote a checkable role; `<hr>` a separator. */
  const items = (): HTMLElement[] => {
    const all = [...menu.querySelectorAll<HTMLElement>(ITEM)];
    for (const item of all) {
      const role = item.getAttribute('role');
      if (role === null || !role.startsWith('menuitem')) item.setAttribute('role', 'menuitem');
    }
    for (const rule of menu.querySelectorAll('hr')) rule.setAttribute('role', 'separator');
    return all;
  };
  const mac = /Mac|iPhone|iPad/.test(host.ownerDocument.defaultView?.navigator?.platform ?? '');
  for (const item of items()) {
    /** A shown shortcut is hidden from the item's name and, where it parses as words, said by `aria-keyshortcuts`. */
    const shown = item.querySelector(':scope > kbd, :scope > vera-kbd');
    if (shown === null) continue;
    shown.setAttribute('aria-hidden', 'true');
    const said = shortcut(shown.localName === 'vera-kbd' ? (shown.getAttribute('keys') ?? '') : (shown.textContent ?? ''), mac);
    if (said !== null && !item.hasAttribute('aria-keyshortcuts')) item.setAttribute('aria-keyshortcuts', said);
  }
  if (__DEV__ && menu.querySelector('a:not([href])') !== null)
    console.warn(diagnostic('menu', '<vera-menu>', 'menu-link-no-href', __DEV__ && PROSE['menu-link-no-href']()));

  /** Where focus goes when the menu opens: set by the gesture that opens it, read at the popover's `toggle`. */
  let focusOnOpen: 'first' | 'last' | 'menu' = 'menu';
  /** The key that is about to click an item (Enter or Space), read by the click it causes. */
  let pressed: string | null = null;
  const typeahead = createTypeahead();

  effect(() => {
    const roving = rovingFocus(menu, {
      items,
      orientation: 'vertical',
      /** Native `disabled` is skipped; `aria-disabled` stays reachable (the APG). */
      skip: (item) => (item as HTMLButtonElement).disabled === true,
    });
    const reachable = () => items().filter((item) => (item as HTMLButtonElement).disabled !== true);
    const focusEnd = (end: 'first' | 'last') => {
      const all = reachable();
      const item = end === 'first' ? all[0] : all[all.length - 1];
      if (item) roving.focus(item);
    };
    /** Open as the popover's own `toggle` last said: no selector the engine might not parse. */
    let shown = false;
    const open = () => shown;
    const close = (refocus: boolean) => {
      if (open()) menu.hidePopover();
      if (refocus) (trigger ?? target)?.focus();
    };

    /** The trigger: the platform toggles the popover; the keys and the click only say where focus goes. */
    const onTriggerKey = (event: KeyboardEvent) => {
      if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
        event.preventDefault();
        focusOnOpen = event.key === 'ArrowUp' ? 'last' : 'first';
        if (open()) focusEnd(focusOnOpen);
        else menu.showPopover();
      }
    };
    const onTriggerClick = (event: MouseEvent) => {
      focusOnOpen = event.detail === 0 ? 'first' : 'menu';
    };

    /**
     * Context mode: open at the pointer, over the target; the native menu is not shown. Where `contextmenu` fires on the
     * press (Firefox and WebKit, and macOS), the platform's light dismiss would close a menu shown then at the release
     * (the press began outside it), so it opens in a task after the release: measured on all three engines.
     */
    let held = false;
    let later = 0;
    const show = () => {
      if (open()) menu.hidePopover();
      menu.showPopover();
    };
    const onPress = (event: PointerEvent) => {
      held = event.button === 2;
    };
    const onRelease = () => {
      held = false;
    };
    /** Placed at the pointer, or for a key at the focused element's block end, and focused by how it opened. */
    const place = (keyed: Element | null, x: number, y: number) => {
      const at = keyed?.getBoundingClientRect();
      point!.style.left = `${at ? at.left : x}px`;
      point!.style.top = `${at ? at.bottom : y}px`;
      focusOnOpen = at ? 'first' : 'menu';
    };
    /**
     * The keys: Shift with the tenth function key, and the ContextMenu key. Chromium fires its own `contextmenu` for them (`button` -1, at the
     * focused element's center); Firefox and WebKit fire none (measured on Windows, all three engines). So a key marks
     * itself, and after its release the menu opens in a task only if no `contextmenu` came: never both.
     */
    let keyed = false;
    let heard = false;
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'ContextMenu' || (event.key === 'F10' && event.shiftKey)) {
        keyed = true;
        heard = false;
      }
    };
    const onKeyUp = (event: KeyboardEvent) => {
      if (!keyed || !(event.key === 'ContextMenu' || event.key === 'F10')) return;
      keyed = false;
      const at = event.target as Element;
      later = setTimeout(() => {
        if (heard) return;
        place(at, 0, 0);
        show();
      }, 0) as unknown as number;
    };
    const onContext = (event: MouseEvent) => {
      event.preventDefault();
      heard = true;
      place(event.button === -1 ? (event.target as Element) : null, event.clientX, event.clientY);
      if (!held) return show();
      host.ownerDocument.addEventListener('pointerup', () => (later = setTimeout(show, 0) as unknown as number), { once: true, capture: true });
    };

    /** The popover opened or closed: focus by modality on open; back to the trigger when focus was inside on close. */
    const onToggle = (event: Event) => {
      const opened = (event as ToggleEvent).newState === 'open';
      shown = opened;
      if (opened) {
        if (focusOnOpen === 'menu') menu.focus();
        else focusEnd(focusOnOpen);
        focusOnOpen = 'menu';
      }
    };

    /** In the menu: from the menu itself the first arrow reaches an item; Tab closes and moves on; typing jumps. */
    const onMenuKey = (event: KeyboardEvent) => {
      const doc = menu.ownerDocument;
      if (event.key === 'Tab') {
        close(true);
        return;
      }
      if (doc.activeElement === menu && (event.key === 'ArrowDown' || event.key === 'ArrowUp' || event.key === 'Home' || event.key === 'End')) {
        event.preventDefault();
        focusEnd(event.key === 'ArrowUp' || event.key === 'End' ? 'last' : 'first');
        return;
      }
      const item = (event.target as Element).closest?.(ITEM);
      if (event.key === 'Enter' || event.key === ' ') {
        if (item) pressed = event.key;
        /** A link or a non-button item takes Space as a click, as a button does. */
        if (event.key === ' ' && item && item.localName !== 'button') {
          event.preventDefault();
          (item as HTMLElement).click();
        }
        return;
      }
      if (event.key.length === 1 && !event.ctrlKey && !event.metaKey && !event.altKey && event.key !== ' ') {
        const all = reachable();
        const index = typeahead.type(event.key, event.timeStamp, all.map((entry) => ({ label: words(entry) })), Math.max(0, all.indexOf(item as HTMLElement)));
        if (index >= 0) roving.focus(all[index]);
      }
    };

    /** An item chosen: its own click has run (it is this event); then `menuaction`, then close unless kept open. */
    const onMenuClick = (event: MouseEvent) => {
      const item = (event.target as Element).closest?.(ITEM);
      const key = pressed;
      pressed = null;
      if (!item || !menu.contains(item)) return;
      if (inert(item)) {
        event.preventDefault();
        return;
      }
      const role = item.getAttribute('role') ?? '';
      let checked: boolean | null = null;
      if (CHECKABLE.test(role)) {
        if (role === 'menuitemradio') {
          const group = item.closest('[role="group"], fieldset') ?? menu;
          for (const other of group.querySelectorAll('[role="menuitemradio"]')) other.setAttribute('aria-checked', String(other === item));
          checked = true;
        } else {
          checked = item.getAttribute('aria-checked') !== 'true';
          item.setAttribute('aria-checked', String(checked));
        }
      }
      const reason: MenuActionReason = event.detail === 0 ? 'keyboard' : 'pointer';
      const detail: MenuActionDetail = { item, value: item.getAttribute('value') ?? words(item), checked, reason };
      const go = host.dispatchEvent(new CustomEvent('menuaction', { detail, bubbles: true, cancelable: true }));
      const stay = !go || item.hasAttribute('data-keep-open') || (key === ' ' && checked !== null);
      if (!stay) close(true);
    };

    trigger?.addEventListener('keydown', onTriggerKey);
    trigger?.addEventListener('click', onTriggerClick);
    target?.addEventListener('contextmenu', onContext);
    target?.addEventListener('pointerdown', onPress);
    target?.addEventListener('keydown', onKey);
    target?.addEventListener('keyup', onKeyUp);
    if (target) host.ownerDocument.addEventListener('pointerup', onRelease, true);
    menu.addEventListener('toggle', onToggle);
    menu.addEventListener('keydown', onMenuKey);
    menu.addEventListener('click', onMenuClick);
    return () => {
      trigger?.removeEventListener('keydown', onTriggerKey);
      trigger?.removeEventListener('click', onTriggerClick);
      target?.removeEventListener('contextmenu', onContext);
      target?.removeEventListener('pointerdown', onPress);
      target?.removeEventListener('keydown', onKey);
      target?.removeEventListener('keyup', onKeyUp);
      host.ownerDocument.removeEventListener('pointerup', onRelease, true);
      clearTimeout(later);
      menu.removeEventListener('toggle', onToggle);
      menu.removeEventListener('keydown', onMenuKey);
      menu.removeEventListener('click', onMenuClick);
      roving.release();
      if (open()) menu.hidePopover();
    };
  });
};
