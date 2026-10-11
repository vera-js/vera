import { init, html } from '@verajs/core';

/** A component whose trusted markup contains a script and a declarative shadow root: neither may act on the server. */
class ContentPage extends HTMLElement {
  connectedCallback() {
    init({ host: this, shadow: 'open' }, () => {
      const markup = '<b id="shown">shown</b><script>globalThis.__contentRan = true;</script>' +
        '<template shadowrootmode="open"><span id="shadow">shadow</span></template>';
      return () => html`<div id="host" .innerHTML=${markup}></div>`;
    });
  }
}
customElements.define('content-page', ContentPage);
export default ContentPage;
