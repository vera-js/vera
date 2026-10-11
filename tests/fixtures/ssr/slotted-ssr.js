import { init, html } from '@verajs/core';
export default class SlottedSsr extends HTMLElement {
  connectedCallback() {
    init({ host: this, shadow: 'open' }, () => {
      return () => html`<div class="frame"><slot></slot></div>`;
    });
  }
}
customElements.define('slotted-ssr', SlottedSsr);
