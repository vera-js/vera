import { createStore } from '@verajs/core';
import { computed } from '@verajs/core';
/** First imported DURING a server render (a component's lazy import): its module scope must stay the process's. */
export const L = createStore({ n: 1 });
export const doubled = computed(() => L.n * 2);
