import { init, html } from '@verajs/core';
import { S } from './store.mjs';
(globalThis.__runs ??= []);
(globalThis.__refs ??= []);
/** Writes the module store in its setup (a request's data), then renders a read of it — counting its own renders. */
class BurstSsr extends HTMLElement {
  connectedCallback() {
    const me = { runs: 0 };
    globalThis.__runs.push(me);
    globalThis.__refs.push(new WeakRef(this));
    init(this, () => {
      S.n = S.n + 1;
      return () => { me.runs++; return html`<b>${S.n}</b>`; };
    });
  }
}
if (!customElements.get('burst-ssr')) customElements.define('burst-ssr', BurstSsr);
export default BurstSsr;
