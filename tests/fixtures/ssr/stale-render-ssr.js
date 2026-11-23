import { init, html } from '@verajs/core';

/**
 * A component whose async `connectedCallback` outlives its render's `timeout` and then writes the shared document, a
 * slow page for that late work to land in, and one that writes its own title in time — see
 * `tests/ssr-stale-render-writes.test.mjs`.
 */
export const RAN = [];
class StaleWriter extends HTMLElement {
  async connectedCallback() {
    init({ host: this, shadow: 'open' }, () => () => html`<p>stale</p>`);
    const where = location.pathname;
    await new Promise((done) => setTimeout(done, 80));
    document.title = `from ${where}`;
    requestAnimationFrame(() => RAN.push(where));
  }
}
class SlowPage extends HTMLElement {
  async connectedCallback() {
    init({ host: this, shadow: 'open' }, () => () => html`<p>page</p>`);
    await new Promise((done) => setTimeout(done, 200));
  }
}
class TitledPage extends HTMLElement {
  async connectedCallback() {
    init({ host: this, shadow: 'open' }, () => () => html`<p>titled</p>`);
    await new Promise((done) => setTimeout(done, 10));
    document.title = `own ${location.pathname}`;
    requestAnimationFrame(() => RAN.push(`own ${location.pathname}`));
  }
}
customElements.define('stale-writer', StaleWriter);
customElements.define('slow-page', SlowPage);
customElements.define('titled-page', TitledPage);
export default StaleWriter;
