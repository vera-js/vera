import { init, html } from '@verajs/core';
/** Takes structured data, which an attribute cannot carry. */
export default class PropsSsr extends HTMLElement {
  connectedCallback() {
    init({ host: this, shadow: 'open' }, () => {
      const rows = this.rows ?? [];
      return () => html`<ul>${rows.map((row) => html`<li>${row.label}</li>`)}</ul>`;
    });
  }
}
customElements.define('props-ssr', PropsSsr);
