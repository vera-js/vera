import { init, html } from '@verajs/core';
/** Renders itself — the case MAX_DEPTH exists for. */
export default class CycleSsr extends HTMLElement {
  connectedCallback() { init({ host: this, shadow: 'open' }, () => {
    return () => html`<cycle-ssr></cycle-ssr>`;
  }); }
}
customElements.define('cycle-ssr', CycleSsr);
