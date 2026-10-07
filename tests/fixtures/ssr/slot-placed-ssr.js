/**
 * An outer component whose TEMPLATE places content into an inner light-slot component — the outer owns those nodes (and
 * their bindings), the inner distributes them. Placed `<i>` (default slot) before `<b slot="t">`, while the inner's
 * `t` slot comes first in its template: light order and document order disagree, so only the statement (or the inner's
 * live record) gives the outer walk the right order.
 */
import { init, render, html } from '@verajs/core';

class SlotPlacedInner extends HTMLElement {
  connectedCallback() {
    init(this);
    render(() => html`<div class="box"><slot name="t">T</slot><slot>FB</slot></div>`);
  }
}
customElements.define('slot-placed-inner', SlotPlacedInner);

export class SlotPlacedSsr extends HTMLElement {
  connectedCallback() {
    init(this);
    const w = 'I', v = 'B';
    render(() => html`<p>outer</p><slot-placed-inner><i>${w}</i><b slot="t">${v}</b></slot-placed-inner>`);
  }
}
customElements.define('slot-placed-ssr', SlotPlacedSsr);
