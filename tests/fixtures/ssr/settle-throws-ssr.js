import { init, render, html } from '@verajs/core';

/** A plain component, rendered while a `'settle'` handler that throws is wired. */
export default class SettleThrowsSsr extends HTMLElement {
  connectedCallback() {
    init(this, { mode: 'open' });
    render(() => html`<p>settled</p>`);
  }
}
customElements.define('settle-throws-ssr', SettleThrowsSsr);
