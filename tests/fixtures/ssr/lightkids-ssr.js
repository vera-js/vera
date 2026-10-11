import { init, html } from '@verajs/core';
/** A shadow component that also puts content in its own light DOM — slotted content it owns. */
export default class LightKidsSsr extends HTMLElement {
  connectedCallback() {
    init({ host: this, shadow: 'open' }, () => {
      this.textContent = 'own light text';
      return () => html`<div><slot></slot></div>`;
    });
  }
}
customElements.define('lightkids-ssr', LightKidsSsr);
