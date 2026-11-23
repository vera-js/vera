/** A value's store: the one it already has, or a new one behind its type's handler. */
import { handlerFor } from './door.js';
import { MARK, cached, promote, remember, wrap } from './identity.js';

/**
 * **A store over a record CORE just made, its proxy kept ON the record, never in the WeakMap.** The props record
 * (`_$raw$`) is built at runtime for each element, and V8 pretenures a constant object literal (old space) but not a
 * runtime-built object, so a young record would pay the WeakMap's young-key cost on insert, on every lookup and in GC.
 * Given its slot here (`promote`'s non-enumerable field: a spread or `Object.keys` never sees it, so the removal's `{
 * ...raw }` copy starts clean), the record costs no WeakMap entry and no `cached()` miss. `cached()` reads the slot
 * first, so `createStore(record)` still answers the same proxy.
 *
 * - ONLY for a record no store wraps yet: `define`'s props record, built FULL by its defaults filler (`filledOf`). It
 *   skips `cached()` on purpose, which a record someone else had already wrapped would turn into a second proxy.
 *
 * - NOT for a class component's record (`propsOf`): with the slot on it, Firefox ran bound class components slower to
 *   create and to churn; that record starts empty and grows after the slot would be defined, where define's is built
 *   full first (the suspected cause, not established).
 *
 * - Not for every store: a field defined on EVERY proxied object costs store rows at creation (`promote`'s note); this
 *   is one record per component.
 *
 * - Born a DATA RECORD (`_record` 1): core built it, a plain object of data properties nobody else writes, so its first
 *   write skips `dataRecord`'s descriptor scan (`Object.getOwnPropertyDescriptors` over every prop, 2.2 ms per 1000
 *   `<vera-button>`s in a Chromium profile). A later accessor defined THROUGH the store clears the mark as before.
 */
export const createOwned = <T extends object>(data: T): T => {
  const proxy = wrap(data, handlerFor(data));
  promote(data, proxy, 1);
  return proxy as T;
};
/** A reactive view of `data`: reads inside a hook subscribe it, writes re-run it. Nested objects are reactive too. */
export const createProxy = <T extends object>(data: T): T => {
  /** Kept from the first lookup: nothing below caches `data` (a handler is decided, a proxy built). */
  const known = cached(data);
  if (known) return known as T;
  if (MARK in data) return data;
  /**
   * Behind its type's handler, claimed or not: a store of a type nothing claims yet is transparent, and
   * becomes reactive the moment a module claiming the type is wired. `null` cached for a nested value
   * means "hand back verbatim" in that slot; asked for as a store in its own right the object is decided
   * afresh, since a frozen *slot* says nothing about the object itself.
   */
  const proxy = wrap(data, handlerFor(data));
  if (known === undefined) remember(data, proxy);
  return proxy as T;
};