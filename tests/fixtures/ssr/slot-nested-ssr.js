/**
 * A light-slot component slotted INSIDE another light-slot component — the generalizability case.
 * Each host distributes only its own direct children, so nesting has to compose with no special
 * handling anywhere: the inner host arrives as one of the outer host's assigned nodes and then
 * captures its own children exactly as a top-level host does.
 */
import { init, render, html } from '@verajs/core';

class SlotInnerSsr extends HTMLElement {
  connectedCallback() {
    init(this);
    render(() => html`<i><slot name="tag">no tag</slot></i><u><slot>no body</slot></u>`);
  }
}
customElements.define('slot-inner-ssr', SlotInnerSsr);

export class SlotOuterSsr extends HTMLElement {
  connectedCallback() {
    init(this);
    render(() => html`<article><header><slot name="header">no header</slot></header><main><slot>no body</slot></main></article>`);
  }
}
customElements.define('slot-outer-ssr', SlotOuterSsr);
