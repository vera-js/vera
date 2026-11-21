import { init, html } from '@verajs/core';
import './scan-ssr.js';

/** A page whose `<font>` inside SVG has a BOUND color, before a registered component — see `ssr-component-scan`. */
class ScanBoundPage extends HTMLElement {
  connectedCallback() {
    init({ host: this, shadow: 'open' }, () => {
      return () => html`<svg><font color=${'red'}><scan-kid></scan-kid></font></svg>`;
    });
  }
}
customElements.define('scan-bound-page', ScanBoundPage);
export default ScanBoundPage;
