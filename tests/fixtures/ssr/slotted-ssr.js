import { init, render, html } from '@verajs/core';
export default class SlottedSsr extends HTMLElement {
  connectedCallback() {
    init(this, { mode: 'open' });
    render(() => html`<div class="frame"><slot></slot></div>`);
  }
}
customElements.define('slotted-ssr', SlottedSsr);
