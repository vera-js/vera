import { init, render, html } from '@verajs/core';

/** A registered shadow component, and a page that places trusted markup holding it — see `ssr-component-scan`. */
class ScanKid extends HTMLElement {
  connectedCallback() {
    init(this, { mode: 'open' });
    render(() => html`<i>kid</i>`);
  }
}
customElements.define('scan-kid', ScanKid);

class ScanPage extends HTMLElement {
  connectedCallback() {
    init(this, { mode: 'open' });
    render(() => html`<div .innerHTML=${globalThis.__SCAN_MARKUP}></div>`);
  }
}
customElements.define('scan-page', ScanPage);
export default ScanPage;
