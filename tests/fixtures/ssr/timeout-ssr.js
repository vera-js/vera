import { init, render, html } from '@verajs/core';

/** Components whose promises never settle, settle late, or reject — see `tests/ssr-render-timeout.test.mjs`. */
class NeverFrame extends HTMLElement {
  connectedCallback() {
    init(this, { mode: 'open' });
    render(() => html`<p>frame</p>`);
    requestAnimationFrame(() => new Promise(() => {}));
  }
}
class NeverConnected extends HTMLElement {
  async connectedCallback() {
    init(this, { mode: 'open' });
    render(() => html`<p>connected</p>`);
    await new Promise(() => {});
  }
}
class LateSettle extends HTMLElement {
  async connectedCallback() {
    init(this, { mode: 'open' });
    render(() => html`<p>settle</p>`);
    this.setAttribute('data-done', 'early');
    await new Promise((done) => setTimeout(done, 60));
    this.setAttribute('data-done', 'late');
  }
}
class LateReject extends HTMLElement {
  async connectedCallback() {
    init(this, { mode: 'open' });
    render(() => html`<p>reject</p>`);
    await new Promise((done, fail) => setTimeout(() => fail(new Error('late-reject')), 30));
  }
}
customElements.define('never-frame', NeverFrame);
customElements.define('never-connected', NeverConnected);
customElements.define('late-settle', LateSettle);
customElements.define('late-reject', LateReject);
export default NeverFrame;
