import { init, html } from '@verajs/core';

/** A plain component, rendered while a `'settle'` handler that throws is wired. */
export default class SettleThrowsSsr extends HTMLElement {
  connectedCallback() {
    init({ host: this, shadow: 'open' }, () => {
      return () => html`<p>settled</p>`;
    });
  }
}
customElements.define('settle-throws-ssr', SettleThrowsSsr);
