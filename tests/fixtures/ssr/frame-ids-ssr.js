/** Three frame-id scenarios run by a component on the server — see `tests/ssr-frame-ids.test.mjs`. */
import { init, html } from '@verajs/core';
import { scenarios } from './frame-scenarios.js';
class FrameIdsPage extends HTMLElement {
  connectedCallback() {
    init({ host: this, shadow: 'open' }, () => {
      return () => html`<p>frames</p>`;
    });
    scenarios(requestAnimationFrame, cancelAnimationFrame, globalThis.__frameLog);
  }
}
customElements.define('frame-ids-page', FrameIdsPage);
export default FrameIdsPage;
