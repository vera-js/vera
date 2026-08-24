import { init, render, html } from '@verajs/core';
/** A shadow component that also puts content in its own light DOM — slotted content it owns. */
export default class LightKidsSsr extends HTMLElement {
  connectedCallback() {
    init(this, { mode: 'open' });
    this.textContent = 'own light text';
    render(() => html`<div><slot></slot></div>`);
  }
}
customElements.define('lightkids-ssr', LightKidsSsr);
