import { wire as register, inserts } from '@verajs/inserts';
import { redecideStores } from './services/createProxy.js';
export { inserts };

/**
 * Installs modules — `wire([renderer, styles])`. When that changed the `'store'` chain, every store type
 * is decided again, so a store module wired after stores exist reaches them all; wiring anything else
 * runs no store module at all.
 */
export const wire: typeof register = (item) => {
  const before = inserts.get('store')?.slice() ?? [];
  register(item);
  const after = inserts.get('store') ?? [];
  if (after.length !== before.length || after.some((insert, i) => insert !== before[i])) redecideStores();
};
export type * from '@verajs/inserts';
export type * from './types.js';
export { createHook } from './modules/createHook.js';
export { createStore } from './modules/createStore.js';
export { init } from './modules/init.js';
export { mount } from './modules/mount.js';
export { render } from './modules/render.js';
export { ref, shallowRef } from './modules/ref.js';
export { untrack } from './modules/untrack.js';
import { untracked } from './modules/untrack.js';
/**
 * Core's tracking control, handed to the modules it is wired to OFF the insert chains (`connect` receives this map):
 * not an extension point — it is core's own tracking stack, and nothing wired later may replace it. `$`-named, so it
 * survives mangling.
 */
(inserts as unknown as { $t: typeof untracked }).$t = untracked;
export { useRender } from './hooks/useRender.js';
export { setRenderScheduler, microtask } from './modules/setRenderScheduler.js';
export { html, mathml, svg } from './store/store.js';
export { useEffect } from './hooks/useEffect.js';
export { useLayoutEffect } from './hooks/useLayoutEffect.js';
export { useSyncEffect } from './hooks/useSyncEffect.js';
