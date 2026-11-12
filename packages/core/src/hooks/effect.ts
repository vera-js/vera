import { EFFECT_PRIORITY, LAYOUT_PRIORITY, MODE_QUEUED, MODE_SYNC, finite, noOwner, register } from '../modules/createHook.js';
import { currentInstance } from '../store/store.js';
import type { ComponentElement, Effect, EffectOptions, HookCallback } from '../types.js';

/**
 * **`effect(fn, options?)` — the ONE primitive for work that follows state** (2026-10-22, the API distillation): it
 * replaced the five `use*` hook functions; core's immediate hook stays internal (it is not a public timing — Brian,
 * 2026-10-22: added if a need appears).
 *
 * ```js
 * effect(() => { document.title = state.title; });                 // after the render, once per flush
 * effect(() => measure(host), { timing: 'layout' });                // after the render, before the effects
 * effect(() => log(state.n), { timing: 'sync' });                   // at once, on every write
 * effect(fn, { priority: 25 });                                     // a custom order — 25 runs before the render
 * const box = effect(fn, { owner: value });                         // a builder's primitive, owned by `value`
 * box.run();  box.stop();
 * ```
 *
 * - **`timing`** names the slot: the default runs after the render (75), `'layout'` after the render and before the
 *   effects (60), `'sync'` at once on every write. **`priority`** is the number underneath, lower first (50 is the render); it orders within a
 *   flush and keeps the timing's mode.
 * - **The owner** is `owner` when given — an element, or any object a builder retires itself — else the component being set up. With
 *   neither it THROWS (`no-owner`), in every build. An effect made in a setup gets its first run when the setup commits; one
 *   made later (an explicit owner) runs when its `run()` is called — as a builder's primitive starts.
 * - **What `fn` returns is its cleanup**, run before its next run and when its owner goes. `fn` is handed the change that
 *   woke it and, on its first run, `true`.
 * - **It returns the effect itself**: `run()` runs it now; `stop()` ends it for good — its cleanup runs once, it leaves
 *   every store, and nothing (a write, a resume, a re-home) runs it again. Nothing is allocated for the handle.
 */
export const effect = (fn: HookCallback, options?: EffectOptions): Effect | undefined => {
  const timing = options?.timing;
  const priority = options?.priority ?? (timing === 'layout' ? LAYOUT_PRIORITY : EFFECT_PRIORITY);
  const owner = (options?.owner as ComponentElement | undefined) ?? currentInstance.element;
  if (!owner) throw new Error(noOwner('an effect'));
  if (!finite(priority, 'effect')) return;
  return register(owner, fn, priority, timing === 'sync' ? MODE_SYNC : MODE_QUEUED) as unknown as Effect;
};
