/** Decides which handler each type of value gets in a store: this copy of core's own, then each wired module's. */
import { inserts } from '@verajs/inserts';
import type { StoreInsert } from '@verajs/inserts';
import { diagnostic, errorOnce, hasWarned, misuse } from '@verajs/shared-utils';
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
export const claimedHandlers = new WeakSet<object>();
/**
 * Store modules that threw while deciding: skipped for EVERY type until replaced — a module that fails
 * for one type is not half-installed across the others, and one bad module cannot make every later
 * `wire` throw. Replacing it (wiring a new function at its priority) is what brings it back.
 */
const broken = new WeakSet<StoreInsert>();
/**
 * **This copy of core's own handlers: the first link of every decision, held HERE, never in the shared chain.** The shared
 * `'store'` chain is page-wide: in development two copies of core on one page share one registry, and a default
 * registered there by one copy would replace the other's (a taken priority replaces), so the other's stores would be
 * decided to the wrong copy's traps. Core's handlers are per copy by nature and modules' are page-wide by nature, so the
 * door keeps one link per copy, with the same signature as any insert, and the traps module hands it in at load.
 */
let defaults: StoreInsert | undefined;
/**
 * Development: the types of which a value was already handed back AS IT IS, nothing claiming them yet (D26, Brian's
 * ruling 2026-11-11: a documented limit, said in development). Such a value keeps that answer: a module wired later
 * reaches only values not read yet, so the claim that finds its type here says so once. Module-level because "already
 * handed back" spans every store; tags only, never the values, so nothing is kept alive. Production drops it.
 */
const handedBack = /* @__PURE__ */ new Set<string>();
/** Development: `value` was handed back as it is, its type unclaimed (`nested`). */
export const handedBackUnclaimed = (value: object) => {
  handedBack.add(TAG.call(value));
};
/**
 * **A store of a type nothing claims is USABLE, and not reactive** (D11, Brian's ruling 2026-11-11; the rebuild's form).
 * `createStore(new Map())` before `collections` is wired, or `createStore(new Date(0))`: its methods run on the real
 * object (a native method refuses a proxy as `this`), so `m.get('a')`, `m.size` and `for (… of m)` work and nothing
 * updates, until a module claims the type: then `redecide` replaces the traps in place and the same store is reactive.
 * A method read twice is the SAME function (`m.get === m.get`), cached per object and name and re-made only if the
 * object's method changed; one that returns its object (`set`, `add`) returns the STORE. Module state, cold: `bound`
 * holds those methods per object, weakly, reached only through a store of a type nothing claims.
 */
const bound = new WeakMap<object, Map<PropertyKey, { m: (...args: unknown[]) => unknown; b: (...args: unknown[]) => unknown }>>();
const transparent = (target: object, key: PropertyKey, receiver: object): unknown => {
  const value = Reflect.get(target, key, target);
  if (typeof value !== 'function') return value;
  let methods = bound.get(target);
  if (methods === undefined) bound.set(target, (methods = new Map()));
  const known = methods.get(key);
  if (known !== undefined && known.m === value) return known.b;
  const method = value as (...args: unknown[]) => unknown;
  const b = function (this: unknown, ...args: unknown[]) {
    const result = method.apply(this === receiver ? target : this, args);
    return result === target ? receiver : result;
  };
  methods.set(key, { m: method, b });
  return b;
};
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
const redecide = (tags: string[]) => {
  const errors: unknown[] = [];
  for (let i = 0; i < tags.length; i++) {
    const owned = types.get(tags[i]) as Record<string, unknown>;
    try {
      const chosen = decide(tags[i]);
      for (const trap in owned) owned[trap] = undefined;
      Object.assign(owned, chosen);
      /** Nothing claims the type: its stores stay usable (`transparent`); a later claim replaces it in place. */
      if (chosen === undefined) owned.get = transparent;
      owned.has = marked(chosen?.has);
      if (__DEV__ && chosen && !claimedHandlers.has(owned) && handedBack.delete(tags[i]))
        console.error(diagnostic('core', `a ${tags[i].slice(8, -1)} read from a store before its module was wired`, 'wired-late', __DEV__ && PROSE['wired-late']()));
      claimedHandlers[chosen ? 'add' : 'delete'](owned);
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
    redecide([tag]);
    /**
     * **A collection in a store with nothing to make it reactive is said once, in development.** A `Map`/`Set` no
     * `'store'` module claims is handed back RAW: it works and never updates the page, the worst failure mode there is,
     * silent. Checked when its TYPE is first decided, a microtask later, so a module wired after a store was first read
     * (supported: `wire` re-decides) is not a false alarm. `hasWarned` skips the microtask once it is out.
     */
    if (__DEV__ && COLLECTION.test(tag) && !hasWarned('no-collections'))
      queueMicrotask(() => {
        if (claimedHandlers.has(types.get(tag)!)) return;
        errorOnce('core', `a ${tag.slice(8, -1)} in a store`, 'no-collections', __DEV__ && (() => PROSE['no-collections']()));
      });
  }
  return owned;
};
/** Every known type decided again — what `wire` calls when the `'store'` chain changed. */
export const redecideStores = () => redecide([...types.keys()]);