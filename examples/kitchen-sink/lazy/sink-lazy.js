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
    render(
      () => html`<div>
        <h2>Lazy loading</h2>
        <h3>Fetched by @verajs/autoloader the first time the element appeared in the DOM</h3>
        <h4>Nothing to click — it was already fetched over the network while this page rendered.</h4>
        <p id="lazy">loaded on demand</p>
      </div>`
    );
  }
}

customElements.define('sink-lazy', SinkLazy);
