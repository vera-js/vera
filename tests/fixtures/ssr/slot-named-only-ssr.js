/** A light-slots component with ONLY a named slot — every text light child goes unassigned, into the carrier. */
import { init, render, html } from '@verajs/core';
export class SlotNamedOnlySsr extends HTMLElement {
  connectedCallback() {
    init(this);
    render(() => html`<header><slot name="h">FH</slot></header>`);
  }
}
customElements.define('slot-named-only-ssr', SlotNamedOnlySsr);
