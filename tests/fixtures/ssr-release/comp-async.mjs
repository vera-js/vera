import { init, html, effect } from '@verajs/core';
import { S } from './store.mjs';
(globalThis.__refs ??= []);
/** An async setup that awaits, THEN registers an element-owned hook (setup has yielded: no running hook, no setup in progress). */
class AsyncSsr extends HTMLElement {
  connectedCallback() {
    globalThis.__refs.push(new WeakRef(this));
    init(this, async () => {
      await Promise.resolve();
      /** Element-owned, created with no running hook and no setup in progress: only the owner marks it born. */
      effect(() => { void S.n; }, { priority: 75, owner: this });
      return () => html`<b>${S.n}</b>`;
    });
  }
}
if (!customElements.get('async-ssr')) customElements.define('async-ssr', AsyncSsr);
export default AsyncSsr;
