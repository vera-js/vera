/**
 * A **shadow** component with a native `<slot>` — the control for the light-slots server pass.
 * Wiring `@verajs/renderer/slots` anywhere in an app must leave this component byte-identical:
 * the platform projects its light children itself, so nothing in the slots module may touch them.
 */
import { init, render, html } from '@verajs/core';

export class SlotShadowSsr extends HTMLElement {
  connectedCallback() {
    init(this, { mode: 'open' });
    render(() => html`<article><header><slot name="header">fallback</slot></header></article>`);
  }
}

customElements.define('slot-shadow-ssr', SlotShadowSsr);
