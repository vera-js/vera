import { init, render, html } from '@verajs/core';
/** Takes structured data, which an attribute cannot carry. */
export default class PropsSsr extends HTMLElement {
  connectedCallback() {
    init(this, { mode: 'open' });
    const rows = this.rows ?? [];
    render(() => html`<ul>${rows.map((row) => html`<li>${row.label}</li>`)}</ul>`);
  }
}
customElements.define('props-ssr', PropsSsr);
