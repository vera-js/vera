import type { ComponentElement, HookRecord } from '../types.js';
import { misuse } from '@verajs/shared-utils';
import { PROSE } from '../diagnostics.js';
import { proxyCallbacks, tracking, unlinkFrom, whenEmptied } from '../store/store.js';
import { same, trackKey, triggerKey, wakeCount } from '../services/track.js';
import { MODE_RAW, register } from './createHook.js';

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
 * a a `'sync'` effect can see the step between (`tests/reactivity-graph.test.mjs` measures it).
 *
 * A throw in a WATCHED evaluation (inside a write) is reported once (the `'error'` chain) and the value stays the last
 * good one; a throw in a read from plain code reaches that code, as TC39's `Signal.Computed` rethrows.
 */
class Computed<T> {
  declare _f: () => T;
  declare _v: T | undefined;
  /** The hook that evaluates it while watched — made at the first watched read. */
  declare _h: HookRecord | undefined;
  /** Watched: linked to its sources, kept current inside the writes. */
  declare _w: boolean;
  /** The write count its pulled value was taken at; −1: none (stale). */
  declare _e: number;

  constructor(fn: () => T) {
    this._f = fn;
    this._v = undefined;
    this._h = undefined;
    this._w = false;
    this._e = -1;
  }

  get value(): T {
    if (tracking.hook !== undefined) {
      if (!this._w) {
        this._w = true;
        (this._h ??= register({} as ComponentElement, () => {
          const value = this._f();
          const previous = this._v;
          if (!same(previous, value)) {
            this._v = value;
            triggerKey(this, 'value', value, previous);
          }
        }, COMPUTED_PRIORITY, MODE_RAW)).$n(undefined, true);
        trackKey(this, 'value');
        whenEmptied(proxyCallbacks.get(this)!.get('value')!, () => release(this));
      } else trackKey(this, 'value');
    } else if (!this._w) {
      /** Pulled from plain code: evaluated untracked (no links to make and drop), cached until the next store write. */
      const now = wakeCount();
      /**
       * A throw REACHES THE CALLER (Brian 2026-10-22; TC39's `Signal.Computed` rethrows): plain code asked for the value
       * and can catch. Only a WATCHED evaluation — inside someone else's write — is reported instead (its hook's run).
       * The count is taken after a successful evaluation, so the next read tries again.
       */
      if (this._e !== now) {
        this._v = this._f();
        this._e = now;
      }
    }
    return this._v as T;
  }
}

/**
 * **A computed whose last reader left lets go at the end of this microtask, if none came back** (2026-10-22). At once
 * would thrash: a re-run whose reads diverge unlinks everything after its first diverging read, a computed included,
 * and reads it again a moment later. Batched in one list per microtask (a microtask per release cost a render making
 * computeds per run +4.8%); one queued twice is harmless — the check below is idempotent.
 */
let releasing: Computed<unknown>[] | undefined;
const release = (c: Computed<unknown>) => {
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
    /**
     * The value cell may be GONE: core sweeps a big key map's reader-less cells (createProxy's `sweepIfDue`). A computed's
     * map holds one key and never reaches the sweep size today; tolerating the absence keeps it safe if that changes — a
     * swept cell is one nobody reads, so releasing is right.
     */
    const cell = proxyCallbacks.get(c)?.get('value');
    if (c._w && (cell === undefined || cell.n === cell.d)) {
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
