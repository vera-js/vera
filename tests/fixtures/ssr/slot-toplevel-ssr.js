import { init, render, html } from '@verajs/core';
/** A light component whose own template has a top-level `${…}` beside its slot — the round-2 B1 shape. */
const loading = () => html`<p class="spin">loading</p>`;
export class SlotToplevelSsr extends HTMLElement {
  connectedCallback() {
    init(this);
    render(() => html`<article><slot name="a">fb</slot></article>${loading()}`);
  }
}
customElements.define('slot-toplevel-ssr', SlotToplevelSsr);
