import { init, html } from '@verajs/core';
/** Sets an attribute on itself during connectedCallback, over whatever the caller passed. */
export default class MutatingSsr extends HTMLElement {
  connectedCallback() {
    init({ host: this, shadow: 'open' }, () => {
      this.setAttribute('role', 'from-component');
      return () => html`<p>m</p>`;
    });
  }
}
customElements.define('mutating-ssr', MutatingSsr);
