/** Decides which handler each type of value gets in a store: this copy of core's own, then each wired module's. */
import { inserts } from '@verajs/inserts';
import type { StoreInsert } from '@verajs/inserts';
import { diagnostic, misuse } from '@verajs/shared-utils';
import { PROSE } from '../diagnostics.js';
import { MARK } from './identity.js';
import { kit } from './track.js';

/**
 * **One handler per TYPE of value, owned here and shared by every proxy of that type**, keyed by the engine's own tag
 * (`Object.prototype.toString`, a constant string: no allocation on a lookup).
 *
 * Core's handler serves plain objects (class instances included) and arrays. Every other type (a `Map`, a `Date`, a
 * typed array, a DOM element) has internal slots a proxy in front of it breaks (`this is not a Date object`), so it
 * starts with an EMPTY handler: a store of one is transparent, and a nested one is handed back raw. A `'store'` insert
 * may claim a type or wrap core's handler.
 *
 * **A decision is made when its inputs change, never per store or per read.** A type is decided the first time one is
 * met; `wire` decides every known type again and writes the result INTO the owned handler objects, so every existing
 * proxy follows: a module wired after the app's stores exist (a store at module scope, imported before the entry wires)
 * reaches them all. The handlers are owned copies because what a chain returns may be shared (core's own serves two
 * types) and must never be rewritten in place.
 */
const TAG = Object.prototype.toString;
const COLLECTION = /^\[object (?:Weak)?(?:Map|Set)\]$/;
const types = new Map<string, ProxyHandler<object>>();
/** The owned handlers some insert or core claimed — an empty one means "not reactive, hand back raw". */
export const claimed = new WeakSet<object>();
/**
 * Store modules that threw while deciding: skipped for EVERY type until replaced — a module that fails
 * for one type is not half-installed across the others, and one bad module cannot make every later
 * `wire` throw. Replacing it (wiring a new function at its priority) is what brings it back.
 */
const broken = new WeakSet<StoreInsert>();
/**
 * **A collection in a store with nothing to make it reactive is said once, in development**.
 * A `Map`/`Set` no `'store'` module claims is handed back RAW — it works and never updates the
 * page, the worst failure mode there is: silent. Checked when its TYPE is first decided (once per page, so once), a
 * microtask later — a module wired after a store was first read (supported: `wire` re-decides) is not a false alarm.
 */
let saidNoCollections = false;
/**
 * **This copy of core's own handlers: the first link of every decision, held HERE, never in the shared chain.** The shared
 * `'store'` chain is page-wide: in development two copies of core on one page share one registry, and a default
 * registered there by one copy would replace the other's (a taken priority replaces), so the other's stores would be
 * decided to the wrong copy's traps. Core's handlers are per copy by nature and modules' are page-wide by nature, so the
 * door keeps one link per copy, with the same signature as any insert, and the traps module hands it in at load.
 */
let defaults: StoreInsert | undefined;
/** Hands the door this copy's own handlers (`traps.ts`, at load). Once per copy: a second call is a build error. */
export const useDefaults = (fn: StoreInsert) => {
  if (__DEV__ && defaults !== undefined) throw new Error(misuse('createStore', 'store-defaults-twice', __DEV__ && PROSE['store-defaults-twice']()));
  defaults = fn;
};
/** What a type (by its tag) gets: this copy's own handler or nothing, then each insert of the shared chain in turn. */
const decide = (tag: string) => {
  const type = tag.slice(8, -1).toLowerCase();
  /** This copy's own handlers first, then each module in the shared chain, in priority order. */
  let chosen = defaults!(type, undefined, kit) as ProxyHandler<object> | undefined;
  /** A plain loop: `forEach` would allocate a closure per decision. */
  const chain = inserts.get('store') as StoreInsert[] | undefined;
  if (chain)
    for (let i = 0; i < chain.length; i++) {
      const insert = chain[i];
      if (broken.has(insert)) continue;
      try {
        chosen = insert(type, chosen, kit) ?? chosen;
      } catch (error) {
        broken.add(insert);
        throw error;
      }
    }
  return chosen;
};
const marked = (has: ProxyHandler<object>['has']) => (target: object, prop: string | symbol) =>
  prop === MARK || (has ? has(target, prop) : Reflect.has(target, prop));
/**
 * **Decides `tags` and writes each into its type's owned handler** — every trap cleared, then the
 * chosen one's copied in, so every proxy of the type follows. When a module throws it is retired
 * (`broken`) and EVERY type is decided again without it — the types it had already joined included —
 * so each handler reflects exactly the healthy modules before the first failure is thrown: from the
 * `wire` that brought the module in, or the read that first met a new type — once.
 */
const settle = (tags: string[]) => {
  const errors: unknown[] = [];
  for (let i = 0; i < tags.length; i++) {
    const owned = types.get(tags[i]) as Record<string, unknown>;
    try {
      const chosen = decide(tags[i]);
      for (const trap in owned) owned[trap] = undefined;
      Object.assign(owned, chosen);
      owned.has = marked(chosen?.has);
      claimed[chosen ? 'add' : 'delete'](owned);
    } catch (error) {
      errors.push(error);
      tags = [...types.keys()];
      i = -1;
    }
  }
  if (errors.length) throw errors[0];
};
/** The owned handler for `value`'s type, deciding the type the first time one is met. */
export const handlerFor = (value: object) => {
  const tag = TAG.call(value);
  let owned = types.get(tag);
  if (owned === undefined) {
    types.set(tag, (owned = {}));
    settle([tag]);
    if (__DEV__ && COLLECTION.test(tag) && !saidNoCollections)
      queueMicrotask(() => {
        if (saidNoCollections || claimed.has(types.get(tag)!)) return;
        saidNoCollections = true;
        console.error(diagnostic('core', `a ${tag.slice(8, -1)} in a store`, 'no-collections', __DEV__ && PROSE['no-collections']()));
      });
  }
  return owned;
};
/** Every known type decided again — what `wire` calls when the `'store'` chain changed. */
export const redecideStores = () => settle([...types.keys()]);