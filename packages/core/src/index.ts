import { wire as register, inserts } from '@verajs/inserts';
import { diagnostic } from '@verajs/shared-utils';
import { PROSE } from './diagnostics.js';
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
    console.warn(diagnostic('core', 'wire', 'late-template-module', __DEV__ && PROSE['late-template-module']()));
};
export type * from '@verajs/inserts';
export type * from './types.js';
export { createHook } from './modules/createHook.js';
export { useHook } from './hooks/coalesce.js';
export { createStore } from './modules/createStore.js';
export { init } from './modules/init.js';
export { mount } from './modules/mount.js';
export { render } from './modules/render.js';
export { ref, shallowRef } from './modules/ref.js';
export { untrack } from './modules/untrack.js';
import { untracked, untrack as untrackFn } from './modules/untrack.js';
import { createStore as createStoreFn } from './modules/createStore.js';
import { createHook as createHookFn } from './modules/createHook.js';
/**
 * Core's tracking control, handed to the modules it is wired to OFF the insert chains (`connect` receives this map):
 * not an extension point — it is core's own tracking stack, and nothing wired later may replace it. `$`-named, so it
 * survives mangling.
 */
(inserts as unknown as { $t: typeof untracked }).$t = untracked;
/**
 * Core's store machinery, handed the same way to a module that keeps stores of its own (`@verajs/directives`): a
 * production directives bundle inlines its own copy of core, and without this its stores and the page's hooks lived in
 * two registries — a directive write never woke a component (vera-5a, 2026-10-09: by `connect`, not a page-global
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
