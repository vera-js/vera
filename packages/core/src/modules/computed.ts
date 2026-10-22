import type { Cell, ComponentElement, HookRecord } from '../types.js';
import { diagnostic, misuse } from '@verajs/shared-utils';
import { PROSE } from '../diagnostics.js';
import { proxyCallbacks, tracking, unlinkFrom, whenEmptied } from '../store/store.js';
import { counting, trackKey, triggerKey, wakeCount } from '../services/createProxy.js';
import { MODE_RAW, register, reportHookError } from './createHook.js';

/**
 * Below the 50 a renderer registers at, so a computed is already up to date by the time anything renders from it.
 */
const COMPUTED_PRIORITY = 10;

/**
 * **A memoized derived value, owned by whoever reads it** (C10, 2026-10-22 — into core from `@verajs/store`).
 *
 * ```js
 * const total = computed(() => cart.items.reduce((n, i) => n + i.price, 0));
 * return () => html`<p>${total.value}</p>`;
 * ```
 *
 * `() => a + b` runs on every read; `computed(() => a + b)` runs once per change of what it read. ONE rule decides its
 * lifetime — **it is WATCHED while some run reads it** (a render, an effect, another computed):
 * - **Watched:** linked to its sources, re-evaluated inside the write that changes one (priority 10, before any render),
 *   and its readers re-run only when the result actually changed (`===`, as a store write).
 * - **Unwatched:** linked to NOTHING (the TC39 rule). It does not evaluate until read; a read from plain code (a
 *   handler, module scope) evaluates untracked and is cached until the next store write anywhere (`wakeCount`).
 * - **When its last reader leaves** (`whenEmptied`), it unlinks from its sources by the end of that microtask (`release`)
 *   — so a dropped computed holds nothing in any store, even one never written again. A run that stops reading a computed already unlinks it (at
 *   its end, or at its first diverging read — a throwing run included), so a computed made in a render or an effect
 *   per run frees itself: no owner list, no disposal pass.
 *
 * **A diamond is not settled between its two halves**, as before: where two computeds read one store and a third
 * reads both, a write re-evaluates the third once per half; a coalesced render or effect sees only the settled value,
 * a `useSyncEffect` can see the step between (`tests/reactivity-graph.test.mjs` measures it).
 *
 * A throw inside an evaluation — watched or pulled — is reported once (the `'error'` chain) and the value stays the last
 * good one, as before.
 */
class Computed<T> {
  declare _f: () => T;
  declare _v: T | undefined;
  /** The hook that evaluates it while watched — made at the first watched read. */
  declare _h: HookRecord | undefined;
  /** Its value cell, once a reader has linked (registered with `whenEmptied` then). */
  declare _c: Cell | undefined;
  declare _w: boolean;
  /** Queued to unwatch at the end of this microtask (`release`). */
  declare _p: boolean;
  /** The write count its untracked value was taken at; −1: none (stale). */
  declare _e: number;

  constructor(fn: () => T) {
    this._f = fn;
    this._v = undefined;
    this._h = undefined;
    this._c = undefined;
    this._w = false;
    this._p = false;
    this._e = -1;
  }

  get value(): T {
    if (tracking.hook !== undefined) {
      if (!this._w) this.$watch();
      trackKey(this, 'value');
      if (this._c === undefined) {
        const cell = (this._c = proxyCallbacks.get(this)!.get('value')!);
        whenEmptied(cell, () => release(this));
      }
      return this._v as T;
    }
    if (this._w) return this._v as T;
    counting.on = true;
    const now = wakeCount();
    if (this._e !== now) {
      this._e = now;
      try {
        this._v = this._f();
      } catch (error) {
        /** As a watched evaluation's throw is (its hook reports it): reported once, the last good value kept. */
        reportHookError(error, undefined, __DEV__ ? diagnostic('core', 'a computed', 'hook-threw', __DEV__ && PROSE['hook-threw']()) : '[vera] hook-threw');
      }
    }
    return this._v as T;
  }

  /** Unwatched → watched: links its sources by evaluating as its own hook (a first pass). */
  $watch() {
    this._w = true;
    (this._h ??= register({} as ComponentElement, () => {
      const value = this._f();
      const previous = this._v;
      if (value !== previous) {
        this._v = value;
        triggerKey(this, 'value', value, previous);
      }
    }, COMPUTED_PRIORITY, MODE_RAW)).$n(undefined, true);
  }
}

/**
 * **A computed whose last reader left lets go at the end of this microtask, if none came back** (2026-10-22). At once
 * would thrash: a re-run whose reads change order unlinks everything after its first diverging read, a computed
 * included, and reads it again a moment later — an immediate unwatch would re-evaluate it and relink its sources each
 * time; so would a row removed and re-added in one task. Deferred, a dropped computed still holds nothing past the
 * microtask, so the bound the rule exists for (nothing kept over a store never written) holds.
 */
let releasing: Computed<unknown>[] | undefined;
const release = (c: Computed<unknown>) => {
  if (c._p) return;
  c._p = true;
  if (releasing === undefined) {
    releasing = [];
    queueMicrotask(releaseAll);
  }
  releasing.push(c);
};
const releaseAll = () => {
  const all = releasing!;
  releasing = undefined;
  for (let i = 0; i < all.length; i++) {
    const c = all[i]!;
    c._p = false;
    const cell = c._c!;
    if (c._w && cell.n === cell.d) {
      c._w = false;
      c._e = -1;
      unlinkFrom(c._h!, 0);
    }
  }
};

export const computed = <T>(fn: () => T): { readonly value: T } => {
  if (__DEV__ && typeof fn !== 'function')
    throw new TypeError(misuse('computed', 'computed-not-function', __DEV__ && PROSE['computed-not-function'](fn === null ? 'null' : typeof fn)));
  return new Computed(fn);
};
