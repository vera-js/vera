import { init, render, html } from '@verajs/core';
export class SlotCardSsr extends HTMLElement {
  connectedCallback() {
    init(this); // light DOM — no shadow options
    render(() => html`<article><header><slot name="header"><em>fallback header</em></slot></header><main><slot>default fallback</slot></main></article>`);
  }
}
customElements.define('slot-card-ssr', SlotCardSsr);
