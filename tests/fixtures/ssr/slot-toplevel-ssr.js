import { init, html } from '@verajs/core';
/** A light component whose own template has a top-level `${…}` beside its slot. */
const loading = () => html`<p class="spin">loading</p>`;
export class SlotToplevelSsr extends HTMLElement {
  connectedCallback() {
    init(this, () => {
      return () => html`<article><slot name="a">fb</slot></article>${loading()}`;
    });
  }
}
customElements.define('slot-toplevel-ssr', SlotToplevelSsr);
