export { inserts } from '@verajs/inserts';
export type * from '@verajs/inserts';
export type * from './types.js';
export type { DeepOption } from './types.js';
export { wire } from './modules/wire.js';
export { createStore } from './modules/createStore.js';
export { snapshot } from './modules/snapshot.js';
export { init } from './modules/init.js';
export { define } from './modules/define.js';
export { signal } from './modules/signal.js';
export { untrack } from './modules/untrack.js';
export { computed } from './modules/computed.js';
export { effect } from './hooks/effect.js';
export { allowRenderLoop, flush, setRenderScheduler, microtask, frameBudget } from './modules/scheduler.js';
export { html, mathml, svg } from './store/store.js';
/** What core hands to the modules wired to it, set once at load (`services/shareSeams.ts`). */
import './services/shareSeams.js';
