/**
 * **<vera-tabs>: its options and its setup.** Never calls `define`: `register.ts` does, so importing the `./element`
 * entry registers nothing.
 *
 * The author's tabs and panels, wired in place. A direct child marked `slot="tabs"` holds the author's `<button>`s; the
 * host's other element children are the panels. Before the script runs they are buttons and sections (served markup
 * carries `hidden` on the inactive panels). After it, the element sets the roles, the ids and the `aria-*` wiring, one
 * tab stop moved by the arrows (`@vera-hooks/roving-focus`), and shows one panel. It renders nothing: the indicator
 * under the selected tab is the container's own `::after`, anchored to that tab by CSS anchor positioning, so it
 * follows a tab's resize, a late font or a transform with no measurement.
 *
 * **Pairing**: a panel is found by key first (its `data-value`, or the id a tab's `aria-controls` names, matched to
 * the tab's `value`), and by order only when no key matches, skipping headings. **Events**: a user's selection fires
 * `beforetabchange` (cancelable, except one from find-in-page, which the browser has already revealed) and then
 * `tabchange`, both bubbling with `detail: { value, previous, reason }`; a write to `value` fires nothing. Not
 * `change`: a form control inside a panel fires a bubbling `change` through the host.
 */
import { effect } from '@verajs/core';
import { adoptOwnSheet, diagnostic } from '@verajs/shared-utils';
import { rovingFocus } from '@vera-hooks/roving-focus';
import { PROSE } from './diagnostics.js';
import { LOOK, SHEET } from './tabs/styles.js';

/** The tag and the element's declared attributes, handed to core's `define` by `register.ts`. */
export const options = { tag: 'vera-tabs', attributes: ['value', 'activation', 'orientation', 'findable'], ownsChildren: true } as const;

/** What `define` hands the setup: the element, with its declared attributes as props. */
interface TabsHost extends HTMLElement {
  value: string | null;
  activation: string | null;
  orientation: string | null;
  findable: string | null;
}

/** Why the selected tab changed: a press, a key, find-in-page reaching a hidden panel, or the selected tab disabled. */
export type TabChangeReason = 'pointer' | 'keyboard' | 'find' | 'disabled';
/** `beforetabchange` and `tabchange`'s detail. */
export type TabChangeDetail = { value: string; previous: string | null; reason: TabChangeReason };

/**
 * Ids this element writes land in the page beside everyone else's, so each carries an instance prefix from the one
 * counter the library's hooks share (`vera.uid`, as `@vera-hooks/labeled` mints its ids), so two copies of the library
 * on one page never mint the same id.
 */
const uid: { n: number } = ((globalThis as Record<symbol, unknown>)[Symbol.for('vera.uid')] ??= { n: 0 }) as { n: number };

/** A tab's key: its `value`, else its position. */
const keyOf = (tab: Element, index: number): string => tab.getAttribute('value') || String(index);
const isHeading = (node: Element): boolean => /^h[1-6]$/.test(node.localName);
const off = (tab: Element): boolean => (tab as HTMLButtonElement).disabled === true || tab.getAttribute('aria-disabled') === 'true';
const FOCUSABLE = 'a[href],button,input,select,textarea,[tabindex],[contenteditable=""],[contenteditable="true"],details>summary';
/**
 * `hidden="until-found"` where the engine has it: find-in-page reaches the panel and fires `beforematch`. Both halves
 * are asked: the event, and the `content-visibility` the engine hides such a panel with (jsdom has the event and hides
 * every `[hidden]` with `display: none`).
 */
const UNTIL_FOUND =
  typeof HTMLElement !== 'undefined' && 'onbeforematch' in HTMLElement.prototype && typeof CSS !== 'undefined' && CSS.supports('content-visibility', 'hidden');

export const setup = (host: TabsHost) => {
  host.setAttribute('data-vera-tabs', '');
  effect(() => adoptOwnSheet(host, SHEET, LOOK), { timing: 'layout' });

  const list = host.querySelector(':scope > [slot="tabs"]');
  if (list === null) {
    if (__DEV__) console.warn(diagnostic('tabs', '<vera-tabs>', 'tabs-no-list', __DEV__ && PROSE['tabs-no-list']()));
    return;
  }
  const id = `vt${++uid.n}`;
  const anchor = `--_vera-tabs-${id}`;
  list.setAttribute('role', 'tablist');
  list.setAttribute('data-vera-part', 'tablist');
  list.setAttribute('data-vera-tabs', '');
  (list as HTMLElement).style.setProperty('--_vera-tabs-anchor', anchor);

  /** Each development warning once per element: `apply` runs at every change to the tabs. True the first time. */
  const said = new Set<string>();
  const first = (code: string): boolean => !said.has(code) && !!said.add(code);

  const tabs = (): Element[] => [...list.children];
  /** The panels, paired with `all` by key, else by order over the host's other children that are not headings. */
  const panels = (all: Element[]): (Element | null)[] => {
    /** One pass over the host's children: each by its key and by its id (the first holder of each wins, as in order). */
    const byKey = new Map<string, Element>();
    const byId = new Map<string, Element>();
    const ordered: Element[] = [];
    for (const child of host.children) {
      if (child === list) continue;
      const value = child.getAttribute('data-value');
      if (value !== null && !byKey.has(value)) byKey.set(value, child);
      if (child.id !== '' && !byId.has(child.id)) byId.set(child.id, child);
      if (!isHeading(child)) ordered.push(child);
    }
    const keyed: (Element | null)[] = [];
    let found = false;
    for (let index = 0; index < all.length; index++) {
      const named = all[index].getAttribute('aria-controls');
      const panel = byKey.get(keyOf(all[index], index)) ?? (named === null ? undefined : byId.get(named)) ?? null;
      if (panel !== null) found = true;
      keyed.push(panel);
    }
    if (found) return keyed;
    if (__DEV__ && ordered.length !== all.length && first('tabs-count-mismatch'))
      console.warn(diagnostic('tabs', '<vera-tabs>', 'tabs-count-mismatch', __DEV__ && PROSE['tabs-count-mismatch'](String(all.length), String(ordered.length))));
    return all.map((_, index) => ordered[index] ?? null);
  };

  let current: string | null = null;
  /** The panels this element gave `tabindex="0"`, so it takes back only its own. */
  const focusable = new WeakSet<Element>();

  /** The roles, ids and wiring, and which panel shows: run at setup, on every change to the tabs, and on a selection. */
  const apply = () => {
    const all = tabs();
    const paired = panels(all);
    let index = all.findIndex((tab, i) => keyOf(tab, i) === current && (tab as HTMLButtonElement).disabled !== true);
    if (index < 0) index = all.findIndex((tab) => !off(tab));
    current = index < 0 ? null : keyOf(all[index], index);
    for (let i = 0; i < all.length; i++) {
      const tab = all[i];
      if (__DEV__ && tab.localName !== 'button' && first('tabs-not-button'))
        console.warn(diagnostic('tabs', '<vera-tabs>', 'tabs-not-button', __DEV__ && PROSE['tabs-not-button']()));
      const panel = paired[i];
      if (!tab.id) tab.id = `${id}-tab-${i}`;
      tab.setAttribute('role', 'tab');
      tab.setAttribute('aria-selected', String(i === index));
      if (panel === null) {
        tab.removeAttribute('aria-controls');
        continue;
      }
      if (!panel.id) panel.id = `${id}-panel-${i}`;
      tab.setAttribute('aria-controls', panel.id);
      panel.setAttribute('role', 'tabpanel');
      panel.setAttribute('aria-labelledby', tab.id);
      /**
       * APG: the shown panel takes focus itself when it holds nothing focusable (read when it is shown; the README says
       * so). Only the shown one: a panel hidden "until-found" keeps its box, so a tabindex left on it keeps it in the
       * Tab order (measured on Chromium, Firefox and WebKit: Tab from the tabs reached the first, hidden panel).
       */
      const takesFocus = i === index && panel.querySelector(FOCUSABLE) === null;
      if (takesFocus && !panel.hasAttribute('tabindex')) {
        panel.setAttribute('tabindex', '0');
        focusable.add(panel);
      } else if (!takesFocus && focusable.has(panel)) {
        panel.removeAttribute('tabindex');
        focusable.delete(panel);
      }
      if (i === index) panel.removeAttribute('hidden');
      else panel.setAttribute('hidden', UNTIL_FOUND && host.findable !== 'false' ? 'until-found' : '');
    }
    if (current !== null && host.getAttribute('value') !== current) host.setAttribute('value', current);
    if (__DEV__ && UNTIL_FOUND) {
      const hidden = paired.find((panel) => panel?.getAttribute('hidden') === 'until-found');
      if (hidden && host.ownerDocument.defaultView?.getComputedStyle(hidden).display === 'none' && first('tabs-until-found-blocked'))
        console.warn(diagnostic('tabs', '<vera-tabs>', 'tabs-until-found-blocked', __DEV__ && PROSE['tabs-until-found-blocked']()));
    }
  };

  /** A user's selection: `beforetabchange` (not cancelable for a find), then the change, then `tabchange`. */
  const choose = (key: string, reason: TabChangeReason) => {
    if (key === current) return;
    const detail: TabChangeDetail = { value: key, previous: current, reason };
    if (!host.dispatchEvent(new CustomEvent('beforetabchange', { detail, bubbles: true, cancelable: reason !== 'find' }))) return;
    current = key;
    apply();
    host.dispatchEvent(new CustomEvent('tabchange', { detail, bubbles: true }));
  };

  current = host.value;
  apply();
  /** The `value` attribute or property: a write from code shows its tab and fires nothing. */
  effect(() => {
    const value = host.value;
    if (value !== null && value !== current) {
      current = value;
      apply();
    }
  });

  /** The listeners, the observer and the tab stop, undone on removal and set again on a move (core's effect rule). */
  effect(() => {
    const vertical = host.orientation === 'vertical';
    if (vertical) list.setAttribute('aria-orientation', 'vertical');
    else list.removeAttribute('aria-orientation');
    const roving = rovingFocus(list, {
      items: tabs,
      orientation: vertical ? 'vertical' : 'horizontal',
      /** Native `disabled` is skipped; `aria-disabled` stays reachable and cannot be chosen (APG). */
      skip: (tab) => (tab as HTMLButtonElement).disabled === true,
      onMove: (tab) => {
        if (host.activation === 'manual' || tab.getAttribute('aria-disabled') === 'true') return;
        choose(keyOf(tab, tabs().indexOf(tab)), 'keyboard');
      },
    });
    /** A press, or Enter and Space on a `<button>` (a click with `detail` 0). */
    const onClick = (event: Event) => {
      const tab = (event.target as Element).closest?.('[role="tab"]');
      if (tab == null || tab.parentElement !== list || off(tab)) return;
      choose(keyOf(tab, tabs().indexOf(tab)), (event as MouseEvent).detail === 0 ? 'keyboard' : 'pointer');
    };
    /** Find-in-page reached a hidden panel: its tab is chosen (the browser has already shown it). */
    const onMatch = (event: Event) => {
      const all = tabs();
      const index = panels(all).findIndex((panel) => panel !== null && panel.contains(event.target as Node));
      if (index >= 0) choose(keyOf(all[index], index), 'find');
    };
    /** Tabs added, removed, renamed or disabled later: the wiring is applied again; a disabled selected tab hands over. */
    const observer = new MutationObserver(() => {
      const before = current;
      apply();
      if (before !== null && current !== null && current !== before)
        host.dispatchEvent(new CustomEvent('tabchange', { detail: { value: current, previous: before, reason: 'disabled' }, bubbles: true }));
    });
    list.addEventListener('click', onClick);
    host.addEventListener('beforematch', onMatch);
    observer.observe(list, { childList: true, subtree: true, attributes: true, attributeFilter: ['disabled', 'aria-disabled', 'value'] });
    return () => {
      observer.disconnect();
      list.removeEventListener('click', onClick);
      host.removeEventListener('beforematch', onMatch);
      roving.release();
    };
  });
};
