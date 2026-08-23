/**
 * Values are listed explicitly rather than re-exported with `export *`, which also pulled in
 * `connectInserts`. That function connects a *module's* registry to core's, so every documented use
 * imports it from the module being connected — never from here — and re-exporting it made core carry
 * its replay loop for a call nothing makes.
 *
 * The types come back separately: `export type *` costs no runtime code, and the insert callback
 * types are the documented way to write an extension.
 */
export { insert, inserts, setRenderer, setAutoloader } from '@verajs/inserts';
export type * from '@verajs/inserts';
export type * from './types.js';
export { commit } from './modules/commit.js';
export { createHook } from './modules/createHook.js';
export { createStore } from './modules/createStore.js';
export { deps } from './modules/deps.js';
export { init } from './modules/init.js';
export { ref, shallowRef } from './modules/ref.js';
export { render } from './modules/render.js';
export { setRenderScheduler, microtask } from './modules/setRenderScheduler.js';
export type { RenderScheduler } from './modules/setRenderScheduler.js';
export { untrack } from './modules/untrack.js';
export { css, html, mathml, setCss, setHtml, svg } from './store/store.js';
export { useEffect } from './hooks/useEffect.js';
export { useLayoutEffect } from './hooks/useLayoutEffect.js';
export { useRender } from './hooks/useRender.js';
export { useSyncEffect } from './hooks/useSyncEffect.js';
