import { InsertFunctionMap, Inserts } from './types.js';
import { Autoloader, Renderer } from '@verajs/shared-types';

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
export const insert = <K extends keyof InsertFunctionMap>(
  insertName: K,
  callback: InsertFunctionMap[K],
  priority: number
) => {
  let chain = inserts.get(insertName) as Chain | undefined;
  if (!chain) inserts.set(insertName, (chain = []));
  const order = (chain._p ??= []);

  const existing = order.indexOf(priority);
  if (existing !== -1) {
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
    chain._p?.forEach((priority, i) => insert(name, chain[i], priority));
  });
};

export const setRenderer = (renderer: Renderer) => {
  insert(
    'render',
    (template, element, ...args) => {
      const el = element.shadowRoot ?? element;
      renderer(template, el, ...args);
    },
    50
  );
};

export const setAutoloader = (autoloader: Autoloader) => {
  insert(
    'render',
    (_, container) => {
      autoloader(container);
    },
    75
  );
};
