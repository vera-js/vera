import { init, html } from '@verajs/core';
import { S } from './store.mjs';
(globalThis.__refs ??= []);
class LeakSsr extends HTMLElement {
  connectedCallback() {
    globalThis.__refs.push(new WeakRef(this));
    init(this, () => () => html`<b>${S.n}</b>`);
  }
}
if (!customElements.get('leak-ssr')) customElements.define('leak-ssr', LeakSsr);
export default LeakSsr;
