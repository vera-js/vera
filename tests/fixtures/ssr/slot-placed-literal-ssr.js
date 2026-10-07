/** The placed-content case, with a literal `<!--[-->`…`<!--]-->` pair in the INNER component's own template. */
import { init, render, html } from '@verajs/core';

class SlotPlacedLiteralInner extends HTMLElement {
  connectedCallback() {
    init(this);
    render(() => html`<div><!--[--><p>own</p><!--]--><slot>FB</slot></div>`);
  }
}
customElements.define('slot-placed-literal-inner', SlotPlacedLiteralInner);

export class SlotPlacedLiteralSsr extends HTMLElement {
  connectedCallback() {
    init(this);
    const w = 'I';
    render(() => html`<p>outer</p><slot-placed-literal-inner><i>${w}</i></slot-placed-literal-inner>`);
  }
}
customElements.define('slot-placed-literal-ssr', SlotPlacedLiteralSsr);
