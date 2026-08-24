/**
 * Fetched by `@verajs/autoloader` the first time it appears inside an `[autoloader]` host.
 *
 * It lives in its own directory precisely so the URL it is fetched from is the thing under test:
 * the autoloader builds `lazy/<tag>.js` and refuses anything resolving outside the entry's own
 * directory.
 */
import { init, render, html } from '@verajs/core';

export default class SinkLazy extends HTMLElement {
  connectedCallback() {
    init(this, { mode: 'open' });
    render(() => html`<p id="lazy">loaded on demand</p>`);
  }
}

customElements.define('sink-lazy', SinkLazy);
