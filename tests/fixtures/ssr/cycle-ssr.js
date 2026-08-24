import { init, render, html } from '@verajs/core';
/** Renders itself — the case MAX_DEPTH exists for. */
export default class CycleSsr extends HTMLElement {
  connectedCallback() { init(this, { mode: 'open' }); render(() => html`<cycle-ssr></cycle-ssr>`); }
}
customElements.define('cycle-ssr', CycleSsr);
