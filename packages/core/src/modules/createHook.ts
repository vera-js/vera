import type { ComponentElement, Hook, HookCallback } from '../types.js';
import { currentInstance, hooksQueue, Sub } from '../store/store.js';
import { diagnostic, prioritySlot, reportUncaught } from '@verajs/shared-utils';
import { PROSE } from '../diagnostics.js';
import { inserts } from '@verajs/inserts';
import type { ErrorInsert } from '@verajs/inserts';

/**
 * **No component being set up: THROWS, in every build** (Brian, 2026-10-09 — one rule for every "no owner" case). A
 * hook, `render()` or `mount()` with none used to be dropped silently, or — after an `await` in setup — attached to
 * whichever component connected meanwhile. `init()` now ends setup at the end of its microtask turn, so the answer no
 * longer depends on what else connected: it fails here, the same way every time.
 */
export const noOwner = (subject: string) => diagnostic('core', subject, 'no-owner', __DEV__ && PROSE['no-owner']());

/** Hoisted, so `prioritySlot` is not handed a fresh closure per registration. */
const newSet = () => new Set<HookCallback>();

/**
 * Hands a thrown hook error to the `'error'` insert chain, or reports it the way the platform reports
 * an uncaught error when nothing is registered — through `reportError`, so `window.onerror` and
 * page-error listeners see it (see `reportUncaught`).
 *
 * Never rethrown: an owner's hooks run in one loop, so an escaping error stopped every hook after
 * the failing one — a single bad effect took out its siblings.
 */
/** A deliberate twin of shared-utils' `reportTo` (the same rule, +11 B there): change both together. */
export const reportHookError = (error: unknown, element: ComponentElement | undefined, line: string) => {
  const handlers = inserts.get('error');
  if (handlers?.length) handlers.forEach((handler) => (handler as ErrorInsert)(error, element));
  else reportUncaught(error, line);
};

/**
 * The priority `useRender` registers at — before `useLayoutEffect` (60) and the effects (75), so a component's first
 * pass draws before its layout effects measure it.
 */
export const RENDER_PRIORITY = 50;

/**
 * Registers a hook on its owner — the element being set up, or `element` when given — and returns
 * the hook itself: run it and it records what it reads, which is how it is subscribed. A component
 * never needs the return value (`render()` runs the first pass); anything owning its own reactive
 * value does, and a `computed`'s owner is a plain object rather than an element.
 *
 * The owner holds the hook strongly, ordered by `priority` (lower runs first; `0` is legal and
 * earliest), and the store holds one weak reference to it — one per hook, so repeated runs add the
 * same entry to a subscription set.
 *
 * **A hook belongs to its owner's generation.** `init()` starts a new one every time an element
 * reconnects, and a hook from an older generation does nothing — otherwise the store, which only
 * holds it weakly, kept running it until a collection happened, and every reconnect doubled the
 * element's renders and effects. Bumping `_$g$` is also how an owner retires its hooks deliberately
 * (`@verajs/directives` does, as teardown).
 *
 * THROWS when there is no owner (`noOwner`, above). Refused, returning `undefined`, when there is no callback or the
 * priority is not a finite number — `NaN` is what `parseInt` of a config value produces.
 *
 * **A change reaching an owner that is out of the tree runs nothing** — a write would otherwise walk
 * every component no one can see. The first pass always runs (a component rendered into a detached
 * container has never been connected, and must still draw), and an owner that is not an element (a
 * `computed`'s) has no `isConnected` to be false. Coming back is what catches it up: `connectedCallback`
 * runs `init()` and a fresh first pass, reading the store as it is now.
 *
 * A throw is isolated here (`reportHookError`), and this one wrapper is every entry: the first pass,
 * a write waking the hook, and a deferred pass — which re-enters through the hook rather than around
 * it — so no caller needs its own catch.
 */
/**
 * Retires every subscription `owner` carries: each hook leaves exactly the Sets it joined. Run on a component's real
 * removal and on a re-init (a new generation) — never on a move, which keeps the component and its subscriptions.
 */
export const retire = (owner: ComponentElement) => {
  let sub = owner._$u$;
  owner._$u$ = undefined;
  /** A loop, never recursion: an element with thousands of hooks retires in constant stack. */
  for (; sub !== undefined; sub = sub.n) {
    const d = sub.d;
    sub.a?.delete(sub);
    sub.b?.delete(sub);
    if (d !== undefined) for (let i = 0; i < d.length; i++) d[i]!.delete(sub);
    sub.a = sub.b = sub.d = undefined;
  }
  /** One level only: what a setup created is never itself an element being set up, so it owns no further owners. */
  const owned = owner._$o$;
  if (owned !== undefined) {
    owner._$o$ = undefined;
    for (let i = 0; i < owned.length; i++) retire(owned[i]!);
  }
};

export const createHook = ({ callback, priority, element }: Hook): HookCallback | undefined => {
  const owner = element ?? currentInstance.element;
  if (!owner) throw new Error(noOwner('a hook'));
  if (!callback || !Number.isFinite(priority)) return;
  const generation = owner._$g$;
  const hook: HookCallback = (signal, init) => {
    if (owner._$g$ !== generation || (!init && owner.isConnected === false)) return;
    hooksQueue.push(sub);
    try {
      callback(signal, init);
    } catch (error) {
      reportHookError(error, owner, __DEV__ ? diagnostic('core', 'a hook', 'hook-threw', __DEV__ && PROSE['hook-threw']()) : '[vera] hook-threw');
    } finally {
      hooksQueue.pop();
    }
  };
  const sub = new Sub(hook, owner._$u$);
  owner._$u$ = sub;
  /**
   * A hook created while a component is being set up, for an owner that is not an element — a `computed` in its setup
   * — is retired with that component. An element owner is never listed: it retires itself, and listing a live child
   * component here would strip its subscriptions when the parent left.
   */
  const host = currentInstance.element;
  if (host !== null && host !== owner && (owner as Partial<Node>).nodeType === undefined)
    (host._$o$ ??= []).push(owner);
  prioritySlot((owner._$h$ ??= []), (owner._$p$ ??= []), priority as number, newSet).add(hook);
  return hook;
};
