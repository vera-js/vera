import { init, render, html } from '@verajs/core';
export class SlotExprSsr extends HTMLElement {
  connectedCallback() {
    init(this);
    const a = 'A', b = 'B', c = 'C';
    render(() => html`<x>${a}</x><s><slot name="s">fb:${b}</slot></s><y>${c}</y>`);
  }
}
customElements.define('slot-expr-ssr', SlotExprSsr);
