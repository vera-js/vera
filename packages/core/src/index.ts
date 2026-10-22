import { wire as register, inserts } from '@verajs/inserts';
import { diagnostic, SHARED } from '@verajs/shared-utils';
import { redecideStores } from './services/createProxy.js';
export { inserts };

/**
 * Installs modules — `wire([renderer, styles])`. When that changed the `'store'` chain, every store type
 * is decided again, so a store module wired after stores exist reaches them all; wiring anything else
 * runs no store module at all.
 */
export const wire: typeof register = (item) => {
  const before = inserts.get('store')?.slice() ?? [];
  const decided = __DEV__ ? (inserts.get('template')?.length ?? 0) + (inserts.get('element')?.length ?? 0) : 0;
  register(item);
  const after = inserts.get('store') ?? [];
  if (after.length !== before.length || after.some((insert, i) => insert !== before[i])) redecideStores();
  /**
   * **A template decision is made once, as the template is built** — so a `'template'` or `'element'` module wired
   * after the renderer built templates never reaches those (they are cached for the life of the page), silently.
   * Stores are re-decided in place above; templates cannot be (the cache is a WeakMap, not a list), so development
   * says so. The renderer marks the registry once it has built a template.
   */
  if (
    __DEV__ &&
    (inserts as unknown as { $b?: boolean }).$b === true &&
    (inserts.get('template')?.length ?? 0) + (inserts.get('element')?.length ?? 0) > decided
  )
    console.warn(diagnostic('core', 'wire', 'late-template-module', __DEV__ && SHARED.lateTemplateModule()));
};
export type * from '@verajs/inserts';
export type * from './types.js';
export { createHook } from './modules/createHook.js';
export { useHook } from './hooks/coalesce.js';
export { createStore } from './modules/createStore.js';
export { init } from './modules/init.js';
export { define } from './modules/define.js';
import { initWith, rehomeElement, retireElement } from './modules/init.js';
export { signal } from './modules/signal.js';
export type { DeepOption } from './modules/signal.js';
export { untrack } from './modules/untrack.js';
export { computed } from './modules/computed.js';
import { untracked, untrack as untrackFn } from './modules/untrack.js';
import { walkItems } from './services/createProxy.js';
import { createStore as createStoreFn } from './modules/createStore.js';
import { createHook as createHookFn } from './modules/createHook.js';
import { register as registerHook, retire, RENDER_PRIORITY, MODE_QUEUED, bare, retireHook, ownerOf, own, settle, serverTurn } from './modules/createHook.js';
import type { ComponentElement, HookCallback, HookRecord } from './types.js';
/**
 * Core's tracking control, handed to the modules it is wired to OFF the insert chains (`connect` receives this map):
 * not an extension point — it is core's own tracking cell, and nothing wired later may replace it. `$`-named, so it
 * survives mangling.
 */
(inserts as unknown as { $t: typeof untracked }).$t = untracked;
/**
 * PROBE (P1, 2026-10-18): core's hook machinery handed to the renderer the same way, so a keyed list can give a row its
 * own QUEUED hook (an explicit owner, chained to the running host by `register`) and retire it. Nothing new: the existing
 * `register` / `retire`, exposed. `$`-named, so it survives mangling.
 */
(inserts as unknown as { $q: (owner: ComponentElement, callback: HookCallback) => HookRecord }).$q = (owner, callback) =>
  /** The record itself, not a `callable` wrapper: one closure fewer per list row (the keyed module calls its `$n`). */
  registerHook(owner, callback, RENDER_PRIORITY, MODE_QUEUED);
(inserts as unknown as { $z: typeof retire }).$z = retire;
/** (2026-10-20) A keyed row's BARE hook — no owner hook list, retired directly — and the hook → owner read a shared row callback needs (`createHook.ts` explains). */
(inserts as unknown as { $qb: typeof bare; $zh: typeof retireHook; $ow: typeof ownerOf }).$qb = bare;
(inserts as unknown as { $zh: typeof retireHook }).$zh = retireHook;
(inserts as unknown as { $ow: typeof ownerOf }).$ow = ownerOf;
/** Option (e): a module claims something for the current run of `hook`; the run's end disposes what it did not claim. */
(inserts as unknown as { $own: typeof own }).$own = own;
/** (e″): a module whose own hooks own things settles them where their runs end (`$so(hook)`), or disposes all (`$so(hook, true)`). */
(inserts as unknown as { $so: typeof settle }).$so = settle;
/** Step 2 (a): a server render's turn — `$ss(1)` opens it, `$ss(-1)` closes it and unlinks what it created (createHook.ts). */
(inserts as unknown as { $ss: typeof serverTurn }).$ss = serverTurn;
/**
 * Step 2 (b), for `@verajs/renderer/native-elements` (imports nothing — a module never imports core at runtime): core's
 * own setup (`$in`, `initWith`) and its removal's whole teardown (`$td`, `retireElement`), so a built-in host gets the
 * lifecycle a custom element's callbacks give it.
 */
(inserts as unknown as { $in: typeof initWith }).$in = initWith;
(inserts as unknown as { $td: typeof retireElement }).$td = retireElement;
/** R4: a built-in host moved into another document re-homes as a component does (native-elements' sentinel calls it). */
(inserts as unknown as { $rh: typeof rehomeElement }).$rh = rehomeElement;
/**
 * A store array's raw walk under ONE subscription (`walkItems`), handed to the renderer the same way, so a keyed list can walk
 * a 1000-row store list without 2000 trapped, tracked reads (measured 2026-10-18: a store walk 280 µs vs a plain one 2;
 * `each` store swap 232 → 55 µs and remove 287 → 58 in Chrome once it walks raw). Without it a list walks the proxy (measured on the since-retired `each`).
 */
(inserts as unknown as { $w: typeof walkItems }).$w = walkItems;
/**
 * Core's store machinery, handed the same way to a module that keeps stores of its own (`@verajs/directives`): a
 * production directives bundle inlines its own copy of core, and without this its stores and the page's hooks lived in
 * two registries — a directive write never woke a component (2026-10-09: by `connect`, not a page-global
 * stamp — the side channel 0.2.0 removed by construction). Position 0 is its PROTOCOL, as every cross-bundle seam
 * carries one: a module from another release declines it and keeps its own copy, rather than calling these with
 * signatures it does not know. Bump it whenever a signature here changes.
 */
(inserts as unknown as { $s: unknown[] }).$s = [1, createStoreFn, createHookFn, untrackFn];
export { useRender } from './hooks/useRender.js';
export { allowRenderLoop, flush, setRenderScheduler, microtask, frameBudget } from './modules/scheduler.js';
export { html, mathml, svg } from './store/store.js';
export { useEffect } from './hooks/useEffect.js';
export { useLayoutEffect } from './hooks/useLayoutEffect.js';
export { useSyncEffect } from './hooks/useSyncEffect.js';
