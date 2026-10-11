/** A light component whose OWN template holds an unpaired literal `<!--[-->` right before a slot, in the same parent. */
import { init, html } from '@verajs/core';
export class SlotLiteralOpenSsr extends HTMLElement {
  connectedCallback() {
    init(this, () => {
      return () => html`<article><main><!--[-->own<slot>fb</slot></main></article>`;
    });
  }
}
customElements.define('slot-literal-open-ssr', SlotLiteralOpenSsr);
