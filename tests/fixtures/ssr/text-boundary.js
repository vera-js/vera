/**
 * The component half of the text-boundary check. The strings live in `text-boundary-cases.js` so a
 * test can import them without defining a custom element — this module runs under `@verajs/ssr`,
 * which has `customElements`; a plain node test does not.
 */
import { init, render, html } from '@verajs/core';
import { CASES } from './text-boundary-cases.js';

export { CASES };

customElements.define('t-text', class extends HTMLElement {
  connectedCallback() {
    init(this, { mode: 'open' });
    render(() => html`<div>${Object.entries(CASES).map(([k, v]) => html`<p data-k=${k} title=${v}>${v}</p>`)}</div>`);
  }
});
