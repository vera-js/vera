import { init, render, html } from '@verajs/core';
export class SlotDupdefaultSsr extends HTMLElement {
  connectedCallback() {
    init(this);
    render(() => html`<article><main><slot>FIRST-FB</slot><slot>SECOND-FB</slot></main></article>`);
  }
}
customElements.define('slot-dupdefault-ssr', SlotDupdefaultSsr);
