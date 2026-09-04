import { init, render, html } from '@verajs/core';
/** A default slot with STATIC CONTENT BEFORE IT in the same parent, so the server's
 *  `data-vera-slotted` offset is non-zero — the shape no other fixture produces. */
export class SlotOffsetSsr extends HTMLElement {
  connectedCallback() {
    init(this); // light DOM
    render(() => html`<article><main><i>PREFIX</i><slot>fallback</slot></main></article>`);
  }
}
customElements.define('slot-offset-ssr', SlotOffsetSsr);
