import { define, html } from '@verajs/core';
import { S } from './store.mjs';
(globalThis.__refs ??= []);
/**
 * R3: an ASYNC setup through `define` — the server must await it (the wrapper reads the pending setup; the generated
 * class returns nothing of its own), so the markup carries the value that arrives after the await.
 */
export default customElements.get('define-async-ssr') ??
  define('define-async-ssr', async (host) => {
    globalThis.__refs.push(new WeakRef(host));
    /** A TIMER, not a microtask: the server drains microtasks and frames anyway, so only awaiting the setup itself
     *  catches a value that arrives after a task (with a one-microtask await this row passed with the join removed). */
    const late = await new Promise((resolve) => setTimeout(() => resolve('late'), 2));
    return () => html`<b>${S.n}</b><i>${late}</i>`;
  });
