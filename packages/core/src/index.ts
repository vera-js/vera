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
    console.warn(
      "[vera] wire: a 'template' or 'element' module (namespaces, elements, slots) was wired after the renderer had " +
        'already built templates — those never ask it, and keep rendering without it. Wire it beside the renderer, ' +
        'before the first render.'
    );
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
