import { wire as register } from '@verajs/inserts';
import { redecideStores } from './services/createProxy.js';
export { inserts } from '@verajs/inserts';

/**
 * Installs modules — `wire([renderer, styles])`. Then every store type is decided again, so a store
 * module wired after stores exist reaches them all; nothing else in core needs to know a module arrived.
 */
export const wire: typeof register = (item) => {
  register(item);
  redecideStores();
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
export { useRender } from './hooks/useRender.js';
export { setRenderScheduler, microtask } from './modules/setRenderScheduler.js';
export { html, mathml, svg } from './store/store.js';
export { useEffect } from './hooks/useEffect.js';
export { useLayoutEffect } from './hooks/useLayoutEffect.js';
export { useSyncEffect } from './hooks/useSyncEffect.js';
