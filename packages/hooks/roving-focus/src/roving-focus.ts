/**
 * **`rovingFocus`: one tab stop for a group, moved by the arrow keys** (the APG's roving tabindex).
 *
 * The hook owns `tabindex` on the items while they are in the group: `0` on the active one, `-1` on the rest, so Tab
 * enters the group once and leaves it in one more stop. Arrows (per `orientation`; Left and Right swap in right to
 * left), Home and End move between reachable items; Tab, Space, Enter and every key with Alt, Ctrl or Meta held are
 * left to the platform. It listens twice per group, on the container: `keydown`, and `focusin`, which makes an item that
 * focus reaches by pointer or by script the active one. Both act only when the focused element itself is one of THIS
 * group's items, so a nested group's keys never move the outer one.
 *
 * Direction is read with `:dir(rtl)` on the focused item at each key, never cached, so no observer is needed. An item's
 * own `tabindex` is overwritten while it is in the group, and put back when it leaves the group or at `release()`.
 */
import { diagnostic } from '@verajs/shared-utils';
import { PROSE } from './diagnostics.js';
import { nextIndex } from './next-index.js';
import type { RovingAxis, RovingFocus, RovingOptions } from './types.js';

/**
 * On an item the hook has touched: the `tabindex` it found there (`null` when it had none), to put back. A field under
 * a `Symbol()` private to this copy, never `Symbol.for`: two copies wiring different groups must never read each
 * other's saved values. Chosen over a node-keyed WeakMap without a race yet (the field is unraced).
 */
const FOUND = Symbol('roving-focus.found');

type Touched = Element & { [FOUND]?: string | null };

/** The default `skip`: a `:disabled` item is passed over; an `aria-disabled` one stays reachable, as the APG asks. */
const disabled = (item: Element): boolean => item.matches(':disabled');

/**
 * @param container The element holding the group, which takes both listeners
 * @param options The group's items, and how it moves
 * @return `focus`, `refresh` and `release`
 */
export const rovingFocus = (container: Element, options: RovingOptions): RovingFocus => {
  const { items, orientation, wrap = true, skip = disabled, onMove } = options;
  /** Every item whose tabindex the hook has set and not yet put back, in the order it first touched them. */
  let touched: Touched[] = [];
  let active: Element | null = null;
  let released = false;
  /** Whether the no-reachable-item warning has printed for this group: once, until an item is reachable again. */
  let warned = false;

  const subject = `<${container.localName}>`;

  const restore = (item: Touched) => {
    const found = item[FOUND];
    if (found === null) item.removeAttribute('tabindex');
    else if (found !== undefined) item.setAttribute('tabindex', found);
    delete item[FOUND];
  };

  /**
   * Gives every item its tabindex: `0` on `next` (or, when it is not a reachable item, the first reachable one), `-1` on
   * the rest; puts back the tabindex of every item that has left the group. Returns the items, as read.
   */
  const sync = (next: Element | null): readonly Element[] => {
    const list = items();
    const kept: Touched[] = [];
    for (const item of touched) if (list.includes(item)) kept.push(item);
    else restore(item);
    touched = kept;
    active = next !== null && list.includes(next) && !skip(next) ? next : (list.find((item) => !skip(item)) ?? null);
    if (active === null) {
      if (__DEV__ && !warned && list.length > 0) console.warn(diagnostic('roving-focus', subject, 'roving-focus-none', __DEV__ && PROSE['roving-focus-none']()));
      warned = true;
    } else warned = false;
    for (const item of list as Touched[]) {
      if (!(FOUND in item)) {
        item[FOUND] = item.getAttribute('tabindex');
        touched.push(item);
      }
      const value = item === active ? '0' : '-1';
      if (item.getAttribute('tabindex') !== value) item.setAttribute('tabindex', value);
    }
    return list;
  };

  /**
   * The element focus is really on: the event's first path entry, inside open shadow roots too. Tested by structure,
   * never `instanceof Node`, whose class differs per realm (a group in an iframe or a popped-out window).
   */
  const focusedOf = (event: Event): Element | null => {
    const first = event.composedPath()[0] as Partial<Node> | undefined;
    return first?.nodeType === 1 ? (first as Element) : null;
  };

  const onKeydown = (event: Event) => {
    const key = event as KeyboardEvent;
    if (key.altKey || key.ctrlKey || key.metaKey || key.defaultPrevented) return;
    const focused = focusedOf(event);
    const list = items();
    if (focused === null || !list.includes(focused)) return;
    const axis: RovingAxis = { orientation, rtl: focused.matches(':dir(rtl)'), wrap };
    const to = nextIndex(list.length, list.indexOf(focused), key.key, axis, (i) => !skip(list[i] as Element));
    if (to === null) return;
    key.preventDefault();
    if (to === -1 || list[to] === focused) {
      sync(to === -1 ? null : focused);
      return;
    }
    const item = list[to] as HTMLElement;
    sync(item);
    item.focus();
    onMove?.(item);
  };

  const onFocusin = (event: Event) => {
    const focused = focusedOf(event);
    if (focused !== null && focused !== active && items().includes(focused) && !skip(focused)) sync(focused);
  };

  container.addEventListener('keydown', onKeydown);
  container.addEventListener('focusin', onFocusin);
  sync(null);

  return {
    focus: (item) => {
      if (released) return;
      if (!items().includes(item) || skip(item)) {
        if (__DEV__) console.warn(diagnostic('roving-focus', `<${item.localName}>`, 'roving-focus-foreign', __DEV__ && PROSE['roving-focus-foreign']()));
        return;
      }
      sync(item);
      (item as HTMLElement).focus();
    },
    refresh: () => {
      if (!released) sync(active);
    },
    release: () => {
      if (released) return;
      released = true;
      container.removeEventListener('keydown', onKeydown);
      container.removeEventListener('focusin', onFocusin);
      for (const item of touched) restore(item);
      touched = [];
      active = null;
    },
  };
};
