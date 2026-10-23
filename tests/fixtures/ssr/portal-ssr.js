import { init, html } from '@verajs/core';
import { portal } from '@verajs/renderer/portal';

/**
 * The server half for tests/renderer-portal: a component that portals into a target of its OWN light content and into
 * the document's body. The server renders the component's template; whatever a portal does there is what the row measures.
 */
globalThis.__portalRuns = 0;
customElements.define('portal-ssr', class extends HTMLElement {
  connectedCallback() {
    init(this, () => {
      portal(document.body, () => { globalThis.__portalRuns++; return html`<aside>portaled</aside>`; });
      return () => html`<p>own</p>`;
    });
  }
});
