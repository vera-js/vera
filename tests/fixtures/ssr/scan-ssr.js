import { init, html } from '@verajs/core';

/** A registered shadow component, and a page that places trusted markup holding it — see `ssr-component-scan`. */
class ScanKid extends HTMLElement {
  connectedCallback() {
    init({ host: this, shadow: 'open' }, () => {
      return () => html`<i>kid</i>`;
    });
  }
}
customElements.define('scan-kid', ScanKid);

class ScanPage extends HTMLElement {
  connectedCallback() {
    init({ host: this, shadow: 'open' }, () => {
      return () => html`<div .innerHTML=${globalThis.__SCAN_MARKUP}></div>`;
    });
  }
}
customElements.define('scan-page', ScanPage);
export default ScanPage;
