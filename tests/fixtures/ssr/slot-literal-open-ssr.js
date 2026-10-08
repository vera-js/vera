/** A light component whose OWN template holds an unpaired literal `<!--[-->` right before a slot, in the same parent. */
import { init, render, html } from '@verajs/core';
export class SlotLiteralOpenSsr extends HTMLElement {
  connectedCallback() {
    init(this);
    render(() => html`<article><main><!--[-->own<slot>fb</slot></main></article>`);
  }
}
customElements.define('slot-literal-open-ssr', SlotLiteralOpenSsr);
