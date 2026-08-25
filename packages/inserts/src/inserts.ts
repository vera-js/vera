import { InsertFunctionMap, Inserts } from './types.js';
import { Autoloader } from '@verajs/shared-types';

export let inserts = new Map<keyof InsertFunctionMap, InsertFunctionMap[keyof InsertFunctionMap][]>();

/**
 * A chain carries its own priority order as a property on the array itself, so the bookkeeping
 * travels with the map through {@link connectInserts}. It previously lived in a module-scope
 * WeakMap — private to each inlined copy of this package — so in the multi-bundle CDN mode an
 * `insert()` through one bundle could not see the order recorded by another: priorities were
 * ignored and same-priority replacement silently duplicated instead.
 *
 * `_p` is a cross-bundle contract read by every inlined copy of this module. Never rename it and
 * never let a minifier mangle it.
 */
type Chain = InsertFunctionMap[keyof InsertFunctionMap][] & { _p?: number[] };

/**
 * Registers a callback into a named insert chain, ordered by priority (lower runs first).
 * Registering at a priority that is already taken replaces it.
 *
 * Entries are stored in a **dense, priority-sorted array** rather than at `array[priority]`.
 * Indexing by priority left holes — registering the renderer at 50 produced a 51-element array
 * with 50 holes — and every chain is walked on the hot path, so iterating those holes cost
 * roughly 238 ns per store read, more than doubling it.
 */
/**
 * Everything an app can hand to {@link registerAll}: a **descriptor** naming the chain it belongs
 * in, or a **connector** — a function handed the registry, which is how a package that imports
 * nothing gets wired to it.
 */
export type InsertDescriptor = {
  on: keyof InsertFunctionMap;
  fn: InsertFunctionMap[keyof InsertFunctionMap];
  priority: number;
  /** For the collision message below. A package should set it; an inline descriptor need not. */
  name?: string;
  /**
   * Called with the registry as the descriptor is wired, for a package that also needs to *read* a
   * chain. `@verajs/renderer` uses it: the same entry that registers it as the renderer hands it
   * the registry it reads `'value'` handlers from, so an app writes one thing, not two.
   */
  connect?: (registry: Inserts) => void;
};
export type Connector = (registry: Inserts) => void;
export type Registerable = InsertDescriptor | Connector;

/**
 * One call listing everything an app wires, in one place, from data rather than side effects.
 *
 * ```js
 * insert([domRender, router, { on: 'init', fn: adoptStyles, priority: 50 }, myOwnThing]);
 * ```
 *
 * A **connector** is a function: it receives the registry and decides what to do with it, which is
 * how `@verajs/router` reaches the `'render'` chain while importing nothing. A **descriptor** is an
 * object naming its chain. Packages export one or the other and never register themselves, so there
 * is no second registry to land in by mistake — the failure `connectInserts` exists to repair.
 */
/**
 * Wires modules into the framework: one call, from data rather than side effects.
 *
 * ```js
 * wire([domRender, connectRouter, { on: 'init', fn: adoptStyles, priority: 50 }]);
 * wire({ on: 'error', fn: report, priority: 40 });
 * ```
 *
 * Three shapes, and every package exports one of the first two rather than registering itself:
 *
 * - a **descriptor** — `{ on, fn, priority }` — naming the insert point it belongs to
 * - a **connector** — a function handed the registry, which is how a package that imports nothing
 *   gets wired to it
 * - an **array** of either
 *
 * The name is the act: you are wiring modules together. `insert` stays as the noun — these are
 * still insert points, and a descriptor still says which one it is `on` — but the verb was never
 * describing what an app does with a list of modules.
 *
 * There is no positional form. `wire('error', fn, 40)` could be got wrong in three ways and read
 * as none of them; an object cannot be misordered and documents its own keys.
 */
export const wire = (item: Registerable | Registerable[]) => {
  if (Array.isArray(item)) {
    for (let i = 0; i < item.length; i++) apply(item[i]);
    return;
  }
  apply(item);
};

const apply = (item: Registerable) => {
  if (typeof item === 'function') item(inserts);
  else {
    item.connect?.(inserts);
    replacing = item.name ?? '';
    register(item.on, item.fn, item.priority);
    replacing = '';
  }
};

let replacing = '';

const register = <K extends keyof InsertFunctionMap>(
  insertName: K,
  callback: InsertFunctionMap[K],
  priority: number
) => {
  /**
   * A priority that is not a finite number breaks the two rules this function is built on, silently.
   * `indexOf(NaN)` is always `-1`, so "a taken priority replaces" stops holding and the same
   * registration stacks up on every call; and `order[slot] < NaN` is false immediately, so it lands
   * at the front of the chain and runs before the renderer. `parseInt` of a config value and
   * `Number(undefined)` both produce it. Nothing throws today and the chain simply misbehaves.
   *
   * `__DEV__`-only, so a production bundle carries neither the check nor the text — the same trade
   * `@verajs/autoloader` makes for `rootDir`.
   */
  if (__DEV__ && !Number.isFinite(priority))
    throw new Error(
      `insert: priority must be a finite number, and "${String(priority)}" is not. ` +
        `Lower runs first; a renderer registers at 50.`
    );

  let chain = inserts.get(insertName) as Chain | undefined;
  if (!chain) inserts.set(insertName, (chain = []));
  const order = (chain._p ??= []);

  const existing = order.indexOf(priority);
  if (existing !== -1) {
    /**
     * **Replacement is the rule, and silence about it was the problem.**
     *
     * Registering at a taken priority replaces — that is how a renderer is swapped, and it is
     * deliberate. But two modules that both claim the default 50 replace each other with no sign:
     * `wire([lists, someOtherLists])` keeps the second, and the first simply never runs. Nothing
     * throws, nothing renders differently until the case only the losing module handled shows up.
     *
     * Named where the descriptor named itself, since "something replaced something at 50" is not
     * actionable. `__DEV__`-only: production carries neither the check nor the text.
     */
    if (__DEV__)
      console.warn(
        `[vera] two things were wired to '${insertName}' at priority ${priority}, so the second ` +
          `replaced the first${replacing ? ` — ${replacing}` : ''}. If both are meant to run, give ` +
          `them different priorities; lower runs first.`
      );
    chain[existing] = callback;
    return;
  }

  let slot = 0;
  while (slot < order.length && order[slot] < priority) slot++;
  chain.splice(slot, 0, callback);
  order.splice(slot, 0, priority);
};

/**
 * Point this bundle's registry at another one, so two standalone bundles share a single set of
 * inserts. Required in CDN mode, where each `.min.js` inlines its own copy of this package; a no-op
 * under a bundler resolving everything to one instance.
 *
 * Anything already registered here is **replayed into the new registry** at its original priority,
 * so the call is order-independent. It used not to be: `connectInserts` replaced the map outright,
 * and a `setRenderer` that ran first became unreachable — silently, since nothing throws and the
 * callback simply lands in a map nobody reads afterwards. An app that rendered nothing, with no
 * indication why, from two lines in the wrong order.
 *
 * Replaying rather than warning costs bytes in a package inlined into `@verajs/core`,
 * `@verajs/renderer` and `@verajs/router` — so it is paid three times over, in the packages least
 * able to afford it. Worth it here because a trap that requires the reader to know an undocumented
 * ordering rule is not a documentation problem, and because the loop is dead weight in the ordinary
 * case: connecting first leaves nothing to replay, and `forEach` over an empty Map is one call.
 *
 * A replayed entry whose priority is already taken replaces it, exactly as a direct `insert` would.
 */
export const connectInserts = (newInserts: Inserts) => {
  const previous = inserts as Map<keyof InsertFunctionMap, Chain>;
  inserts = newInserts;
  previous.forEach((chain, name) => {
    chain._p?.forEach((priority, i) => register(name, chain[i], priority));
  });
};

export const setAutoloader = (autoloader: Autoloader) => {
  register(
    'render',
    (_, container) => {
      autoloader(container);
    },
    75
  );
};
