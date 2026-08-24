import { init, render, html } from '@verajs/core';
/** Sets an attribute on itself during connectedCallback, over whatever the caller passed. */
export default class MutatingSsr extends HTMLElement {
  connectedCallback() {
    init(this, { mode: 'open' });
    this.setAttribute('role', 'from-component');
    render(() => html`<p>m</p>`);
  }
}
customElements.define('mutating-ssr', MutatingSsr);
