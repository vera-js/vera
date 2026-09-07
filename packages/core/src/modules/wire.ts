/**
 * Core's `wire` — inserts' registrar plus the SUBSTRATE STAMP.
 *
 * The stamp is how a bundle carrying its own baked copy of core's store machinery (the
 * `@verajs/directives` standalone builds) finds the copy the app actually uses: `wire` is only
 * ever called on that copy — a copy inlined as someone's substrate never has its `wire` called —
 * so stamping here rather than at module scope is what makes adoption deterministic, and load
 * order costs nothing because an `'init'`-driven consumer cannot activate before `wire` has run.
 * This is also why the rule "take `wire` from `@verajs/core`, never from `@verajs/inserts`" is
 * now load-bearing twice: inserts' registrar writes to the right map, but only core's `wire`
 * announces the substrate.
 *
 * The property names are literal on purpose: this is a cross-bundle surface, and the mangler
 * must never touch it (the renderer's sigil rule, applied here).
 */
import { wire as register, inserts } from '@verajs/inserts';
import { createHook } from './createHook.js';
import { createStore } from './createStore.js';

export const wire: typeof register = (item) => {
  /** `inserts` rides along so an adopted consumer reads the PAGE's chains — the `'loader'`
   *  seam is the first customer: a directives bundle with its own baked registry must still
   *  find the autoloader the app wired through THIS copy. */
  (globalThis as Record<symbol, unknown>)[Symbol.for('vera.core')] = { createStore, createHook, inserts };
  register(item);
};
