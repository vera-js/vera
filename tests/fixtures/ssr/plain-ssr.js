import { init, html } from '@verajs/core';
/** No store, no effects — the floor for what a render retains. */
export default class PlainSsr extends HTMLElement {
  connectedCallback() { init({ host: this, shadow: 'open' }, () => {
    return () => html`<p>plain</p>`;
  }); }
}
customElements.define('plain-ssr', PlainSsr);
