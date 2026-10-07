/** An outer template BINDING a list into an inner light-slot component: a run, which the inner distributes by name. */
import { init, render, html } from '@verajs/core';

class SlotRunInner extends HTMLElement {
  connectedCallback() {
    init(this);
    render(() => html`<div class="box"><slot name="t">T</slot><slot>FB</slot></div>`);
  }
}
customElements.define('slot-run-inner', SlotRunInner);

export class SlotRunSsr extends HTMLElement {
  connectedCallback() {
    init(this);
    const items = ['a', 'b', 'c'];
    render(() => html`<p>outer</p><slot-run-inner>${items.map((x) => html`<i slot=${x === 'b' ? 't' : ''}>${x}</i>`)}</slot-run-inner>`);
  }
}
customElements.define('slot-run-ssr', SlotRunSsr);
