import { init, html } from '@verajs/core';
import { until } from '@verajs/renderer/until';

/**
 * The server half for tests/renderer-until: a component whose template shows `until(a promise that NEVER settles, a
 * fallback)`, and one whose promise REJECTS. The server renders both fallbacks, does not wait, and does not crash on the
 * rejection (Node ends a process on an unhandled rejection by default).
 */
customElements.define('until-ssr', class extends HTMLElement {
  connectedCallback() {
    init(this, () => () => html`<p>${until(new Promise(() => {}), html`<em>loading</em>`)}</p><p>${until(Promise.reject(new Error('fetch failed')), html`<em>still serving</em>`)}</p>`);
  }
});
