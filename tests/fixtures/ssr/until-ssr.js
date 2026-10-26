import { init, html } from '@verajs/core';
import { until } from '@verajs/renderer/until';

/**
 * The server half for tests/renderer-until: a component whose template shows `until(a promise that NEVER settles, a
 * fallback)`. The server renders the fallback and does not wait for the promise (the row times it).
 */
customElements.define('until-ssr', class extends HTMLElement {
  connectedCallback() {
    init(this, () => () => html`<p>${until(new Promise(() => {}), html`<em>loading</em>`)}</p>`);
  }
});
