/** A light component whose OWN template holds a literal `<!--[-->…<!--]-->` pair — the region markers' spelling — at a non-slot position. */
import { init, html } from '@verajs/core';
export class SlotLiteralSsr extends HTMLElement {
  connectedCallback() {
    init(this, () => {
      return () => html`<article><!--[--><p>own</p><!--]--><main><slot>fb</slot></main></article>`;
    });
  }
}
customElements.define('slot-literal-ssr', SlotLiteralSsr);
