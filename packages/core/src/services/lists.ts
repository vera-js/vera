/** A store array's raw slots, walked under one subscription: what a keyed list's render reads. */
import { FIXED, PROXY, RAW, promote } from './identity.js';
import { ITEMS, nested } from './traps.js';
import { track } from './track.js';
import type { Slot } from '../types.js';

/**
 * A plain store array's RAW slots, read WITHOUT subscribing (`undefined` for anything else: a plain array, a subclass,
 * another kind of proxy). Only for comparing against what a walk already met; whoever depends on the contents
 * subscribes through `walkItems`. Handed to modules as `$wr`.
 */
export const rawItems = (list: unknown): unknown[] | undefined => {
  const raw = list !== null && typeof list === 'object' ? (list as Record<symbol, unknown[] | undefined>)[RAW] : undefined;
  return raw === undefined || Object.getPrototypeOf(raw) !== Array.prototype ? undefined : raw;
};
/**
 * **Walks a store array's RAW slots under ONE subscription** — what a keyed list's render does on every update. Through
 * the proxy each slot costs a trap (≈ 33 ns in V8 even with no trap function) plus a per-index subscription; here the
 * running hook subscribes to `ITEMS` once and `visit` gets each slot raw and as a read would hand it back. `false` when
 * `list` is not an array store (a plain array, a subclass): the caller walks it itself. Handed to modules as `$w`.
 */
export const walkItems = (list: unknown, visit: (raw: unknown, item: unknown) => void, from = 0, to?: number): boolean => {
  const raw = rawItems(list);
  if (raw === undefined) return false;
  track(raw, ITEMS);
  const fixed = FIXED.has(raw);
  /**
   * `from` / `to`: only the slots a caller could not settle itself — a keyed list matches its unchanged ends on the raw
   * slots (`rawItems`) and walks only the middle. The ONE subscription above is made either way, so a write to a skipped
   * slot still wakes the walker.
   */
  const end = to ?? raw.length;
  for (let i = from; i < end; i++) {
    const value = raw[i];
    if (value === null || typeof value !== 'object' || fixed) visit(value, value);
    else {
      /**
       * The cache field read HERE, not through `cached`: this site only ever meets one list's items, so the engine
       * keeps the read monomorphic, where `cached`, shared by every object in the app, goes megamorphic.
       */
      const slot = (value as Record<symbol, Slot | undefined>)[PROXY];
      if (slot !== undefined && slot._owner === value) visit(value, slot._store ?? value);
      else {
        const item = nested(raw, i, value);
        if (item !== value) promote(value, item);
        visit(value, item);
      }
    }
  }
  return true;
};