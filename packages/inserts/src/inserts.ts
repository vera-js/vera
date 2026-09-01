import { InsertFunctionMap, Inserts } from './types.js';

export const inserts = new Map<keyof InsertFunctionMap, InsertFunctionMap[keyof InsertFunctionMap][]>();

/**
 * A chain carries its own priority order as a property on the array itself, so the bookkeeping
 * travels with the map itself. It previously lived in a module-scope
 * WeakMap — private to each inlined copy of this package — so in the multi-bundle CDN mode an
 * `insert()` through one bundle could not see the order recorded by another: priorities were
 * ignored and same-priority replacement silently duplicated instead.
 *
 * `_p` is a cross-bundle contract read by every inlined copy of this module. Never rename it and
 * never let a minifier mangle it.
 */
type Chain = InsertFunctionMap[keyof InsertFunctionMap][] & { _p?: number[] };

/**
 * Everything an app can hand to {@link wire}: a **descriptor** naming the chain it belongs
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
 * Wires modules into the framework: one call, from data rather than side effects.
 *
 * ```js
 * wire([renderer, router, styles]);
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

/**
 * **A descriptor is anything that names an insert point**, and that is tested before the connector
 * case rather than after. A module is free to be a function *and* a descriptor — `@verajs/autoloader`
 * is exactly that, because configuring it and registering it are one call — and without this order
 * such a module would be called as a connector and never registered.
 */
const apply = (item: Registerable) => {
  /**
   * **Is it either of the two things at all?** Everything below validates one shape or the other —
   * a function that turned out to be `render` rather than `renderer`, a descriptor whose priority is
   * `NaN` — and nothing asked whether an item was a module in the first place. So `wire(undefined)`,
   * which is what a mistyped import name produces, fell through to the descriptor branch and threw
   * *`priority must be a finite number, and "undefined" is not`*: a true sentence about the wrong
   * thing, which sends the reader looking for a priority they never wrote.
   *
   * `__DEV__`-only, so production carries neither the check nor the text.
   */
  if (__DEV__) {
    const descriptor = item as Partial<InsertDescriptor> | null | undefined;
    const shape = typeof item;
    if (item == null || (shape !== 'function' && shape !== 'object'))
      throw new Error(
        `wire: expected a module or an insert descriptor, and received ${String(item)}. ` +
          `Check the import name — \`wire([renderer, router])\`.`
      );
    /**
     * **Name the key that is wrong, not the shape that is right.**
     *
     * This used to report the whole contract — *"one needs `on`, `fn` and `priority`"* — for an
     * object that had two of the three. The case that matters is `fn: undefined`, which is what an
     * import resolving to nothing produces: `wire({ on: 'render', fn: render, priority: 50 })` after
     * `render` moved packages is a descriptor whose `on` and `priority` are exactly right, and the
     * reader was sent to check them. A `fn` that is `undefined` says so, and says why it usually is.
     */
    if (shape === 'object' && (typeof descriptor!.on !== 'string' || typeof descriptor!.fn !== 'function')) {
      const who = descriptor!.name ? `\`${descriptor!.name}\`` : 'that object';
      const wrong =
        typeof descriptor!.on !== 'string'
          ? `\`on\` names the insert point and must be a string — this one is ${String(descriptor!.on)}`
          : `\`fn\` is the callback and must be a function — this one is ${String(descriptor!.fn)}` +
            (descriptor!.fn === undefined
              ? ', which is what an import that resolved to nothing looks like. Check the name: ' +
                "`@verajs/renderer`'s draw is `renderInto`, and the module to wire is `renderer`."
              : '');
      throw new Error(`wire: ${who} is not an insert descriptor. ${wrong}`);
    }
  }
  if (typeof item === 'function' && (item as Partial<InsertDescriptor>).on === undefined) {
    /**
     * A raw function that a package marked as "not the module" — `@verajs/renderer` marks `render`,
     * which sits two characters from `renderer`. Without this the mistake is silent: the function is
     * treated as a connector, handed the registry, and nothing is ever registered.
     *
     * `__DEV__`-only, so production carries neither the check nor the text.
     */
    if (__DEV__) {
      const meant = (item as { $module?: string }).$module;
      if (meant !== undefined)
        throw new Error(
          `wire: \`${item.name || 'that function'}\` is not a module — did you mean \`${meant}\`? ` +
            `A bare function is wired as a connector and handed the registry, so this would have ` +
            `registered nothing and thrown nothing.`
        );
    }
    item(inserts);
  } else {
    item = item as InsertDescriptor;
    item.connect?.(inserts);
    replacing = item.name ?? '';
    register(item.on, item.fn, item.priority);
    replacing = '';
  }
};

let replacing = '';

/**
 * Bumped by every registration, so a reader can cache a chain and know when the cache is stale.
 *
 * The chains that matter are read on the framework's hottest paths — `'proxy-handler'` on every
 * property read of every store, `'set-handler'` on every write — and a `Map.get` with a string key
 * on each of those measured at **13% of a tracked read**. A registration is a once-per-app event;
 * a read is a once-per-property-access event, so the cost belongs on the registration side.
 *
 * A live binding rather than a getter: an importer sees the current value with no call, and when a
 * production bundle inlines this module it becomes the same variable rather than a copy.
 */
export let revision = 0;

/**
 * Registers a callback into a named insert chain, ordered by priority (lower runs first).
 * Registering at a priority that is already taken replaces it.
 *
 * Entries are stored in a **dense, priority-sorted array** rather than at `array[priority]`.
 * Indexing by priority left holes — registering the renderer at 50 produced a 51-element array
 * with 50 holes — and every chain is walked on the hot path, so iterating those holes cost
 * roughly 238 ns per store read, more than doubling it.
 */
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
      `wire: priority must be a finite number, and "${String(priority)}" is not. ` +
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
    /**
     * **The same module wired twice is not two things.**
     *
     * An app whose entry points share a wiring module calls `wire([styles])` from each of them, and
     * this warned that the second had replaced the first — of a callback identical to the one
     * already there, so nothing was replaced and nothing was lost. The advice it gave was wrong for
     * that case too: giving `styles` a second priority would make it run twice.
     *
     * It fired in this repo's own kitchen-sink example, which is the reference application. A
     * warning the reference app trips on is a warning people learn to scroll past, and then the real
     * one — two *different* modules silently claiming 50 — goes past with it.
     *
     * The comparison is inside the `__DEV__` guard, so production carries neither it nor the text.
     * A module that builds a fresh closure per call (`autoloader(base, dir)`) still warns, correctly:
     * those are two observers, and only one of them would run.
     */
    if (__DEV__ && chain[existing] !== callback)
      console.warn(
        `[vera] two things were wired to '${insertName}' at priority ${priority}, so the second ` +
          `replaced the first${replacing ? ` — ${replacing}` : ''}. If both are meant to run, give ` +
          `them different priorities; lower runs first.`
      );
    /**
     * In place, so a cached reference to this chain stays correct and `revision` need not move —
     * the array identity is what a reader caches, and replacement does not change it. Only creating
     * a chain or changing its length does, and both fall through to the bump below.
     */
    chain[existing] = callback;
    return;
  }

  let slot = 0;
  while (slot < order.length && order[slot] < priority) slot++;
  chain.splice(slot, 0, callback);
  order.splice(slot, 0, priority);
  revision++;
};
