import type { Untracked } from './types.js';
import { diagnostic } from './diagnostic.js';
import * as SHARED from './diagnostics.js';

/**
 * Get an object's type.
 *
 * @param  obj The object
 * @return The type
 */
export const getType = (obj: unknown) => Object.prototype.toString.call(obj).slice(8, -1).toLowerCase();

/**
 * Weak collections need their per-key dependencies stored weakly, or tracking `weakMap.get(obj)`
 * holds `obj` and defeats the whole point of the type. Checked by type string rather than
 * `instanceof`, which fails across realms (iframes, `vm`).
 */
export const isWeakCollection = (item: unknown) => getType(item)[0] === 'w';

/**
 * Remove a trailing slash from an url if its not root url (`/`).
 *
 * @param str String to remove trailing slash from
 */
export const stripTrailingSlash = (str: string) => (str !== '/' && str.endsWith('/') ? str.slice(0, -1) : str);

/**
 * Finds the entry for `priority` in a dense, priority-sorted pair of arrays, creating one if it is
 * not there yet. `order` holds the priorities and `list` the values at matching indices.
 *
 * Priority is deliberately NOT used as an array index. Indexing by priority leaves holes — hooks at
 * 25/50/75 produce a 76-element array with 73 of them empty — and these arrays are walked on every
 * render and every write, so the holes dominated the cost.
 *
 * @param list Values, ordered by ascending priority
 * @param order Priorities, parallel to `list`
 * @param priority Priority to find or create
 * @param create Builds the value when the priority is not present yet
 * @return The existing or newly created value
 */
export const prioritySlot = <T>(list: T[], order: number[], priority: number, create: () => T): T => {
  let slot = 0;
  while (slot < order.length && order[slot] < priority) slot++;
  if (order[slot] === priority) return list[slot];

  order.splice(slot, 0, priority);
  const created = create();
  list.splice(slot, 0, created);
  return created;
};

/**
 * **Reports an error nothing else handled, the way the platform reports one.** `reportError` fires
 * the window's `error` event — what `window.onerror`, error trackers and test runners listen for —
 * without unwinding the caller, so one failing hook or ref never stops its siblings. A bare
 * `console.error` reached none of those: a component could stop updating while every page-error
 * listener stayed silent. Off-browser (Node has no `reportError`) the console is all there is.
 * `line` is the framework's own line, printed beside the error — a CODED one (code-system phase 5, 2026-10-09):
 * each caller passes `'[vera] <code>'` in production and its table's `diagnostic()` sentence in development, both
 * literal codes at the call site, so the static checks read them. The subject is fixed wording too (`a hook`, `an
 * element ref`), never a tag name: this line is the console's FORMAT (no `'%s'`, which measured +2–3 B on the renderer
 * bundles), so nothing from outside may reach it — the element goes to the `'error'` handlers instead. Production prints it only where the platform has no
 * `reportError` (Node); in a browser, `reportError` alone reports.
 *
 * Shared by core (a hook threw) and the renderer (a ref threw) so the fallback is one rule.
 */
export const reportUncaught = (error: unknown, line: string) => {
  if (typeof reportError !== 'function') console.error(line, error);
  else {
    if (__DEV__) console.error(line, error);
    reportError(error);
  }
};

/**
 * **Reports what user code a render called threw — to the app's `'error'` chain, else as uncaught.** One rule for
 * every callback the framework runs on the user's behalf and survives: a hook (core), an element ref, and an element
 * claim's `create`/`mount`/`unmount` (the renderer). The caller catches at the call site and carries on, so one
 * failing callback never stops its siblings or leaves a commit half applied. `element` is the component the error
 * belongs to, handed to each handler. Every throw is reported — nothing is deduped, as a hook's never was.
 * **Core keeps a deliberate twin** (`reportHookError`, the same rule as a `forEach`): routed through here it measured
 * +11 B gzip on `vera.min.js` (2026-10-09). A change to the rule changes both.
 */
export const reportTo = (handlers: readonly unknown[] | undefined, error: unknown, element: Element | undefined, line: string) => {
  if (handlers?.length) for (const handler of handlers) (handler as (error: unknown, element?: Element) => void)(error, element);
  else reportUncaught(error, line);
};

/** The component a render root belongs to: a shadow root's host, or a light root itself. */
export const hostOf = (root: Node | null | undefined): Element | undefined =>
  root == null ? undefined : root.nodeType === 11 ? (root as ShadowRoot).host : (root as Element);

/** `fn(a, b, c)`, tracked as the caller is — the stand-in for core's `untracked` when no core was wired. */
export const call: Untracked = (fn, a, b, c) => fn(a!, b!, c!);

/**
 * **Whether a property binding is a `<select>`'s SELECTION** — `value` or `selectedIndex` — which the renderer and
 * `spread` both treat as live: re-asserted every render and compared against the live value (as `!value` is), because
 * a select's options can be replaced under an unchanged value, which drops the selection. One rule, asked once per
 * binding by both, so a template and a spread key cannot disagree about it.
 *
 * In development it names the one shape it cannot serve: on a `<select multiple>` both properties read and set a
 * SINGLE selection, so a selection the user adds is kept rather than controlled. Always writing there was measured
 * 2–3% slower on every table with a select per row, to serve an API that does not fit — hence a warning, not a cost.
 */
export const isSelection = (element: Element, name: unknown) => {
  if ((name !== 'value' && name !== 'selectedIndex') || element.localName !== 'select') return false;
  return true;
};

/**
 * Development: the one shape a selection binding cannot serve, named by the module the user wired (`side`). Called only
 * behind `__DEV__` at each call site, so production keeps `isSelection` exactly as small as it was (a `side` argument on
 * it measured +1 B, a default +9 B on vera-renderer.min.js — 2026-10-09).
 */
export const saySelectMultiple = (element: Element, name: unknown, side: string) => {
  if (element.hasAttribute('multiple'))
    console.warn(diagnostic(side, '<select multiple>', 'select-multiple', __DEV__ && SHARED.selectMultiple(String(name))));
};

/**
 * `target[key]`, as a function — how a component's GETTER is read through `untracked`. Not `Reflect.get`: `untracked`
 * passes three arguments, and `Reflect.get`'s third is the RECEIVER — `undefined` there runs the getter with no `this`.
 */
export const read = (target: object, key: string) => (target as Record<string, unknown>)[key];

/**
 * **What a thrown value says, whatever was thrown — and it never throws itself.** A caught value comes from author
 * code (a `resolve` option, a motion tick or vocabulary function), and JavaScript can throw anything: `null`, an object
 * with no prototype (`String()` finds no `toString`), one whose `toString` or `message` getter throws, a Proxy whose
 * traps throw. Formatting it naively replaced the real failure with an unrelated TypeError from inside the framework.
 * Anything unreadable becomes a fixed phrase; `Object.prototype.toString` is no fallback, since it reads
 * `Symbol.toStringTag` through a Proxy's trap too.
 *
 * **A deliberate duplicate of `thrownMessage` in `packages/ssr/src/vera/escaping.ts` — fix both copies.** `@verajs/ssr`
 * is compiled per file with no bundling, so it cannot import this private, unpublished package at run time;
 * `tests/thrown-message-copies.test.mjs` runs one table of thrown values against both, so they cannot drift.
 */
export const thrownMessage = (error: unknown): string => {
  try {
    if (error instanceof Error) return String(error.message);
    const message = (error as { message?: unknown } | null)?.message;
    return typeof message === 'string' ? message : String(error);
  } catch {
    return '[unprintable value thrown]';
  }
};
