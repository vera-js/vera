import { init, render, html } from '@verajs/core';

/** Components that wait on a definition the server never makes — see `tests/ssr-when-defined.test.mjs`. */
class WaitReturned extends HTMLElement {
  connectedCallback() {
    init(this, { mode: 'open' });
    render(() => html`<p>returned</p>`);
    requestAnimationFrame(() => customElements.whenDefined('wd-never-defined'));
  }
}
class WaitAsync extends HTMLElement {
  connectedCallback() {
    init(this, { mode: 'open' });
    render(() => html`<p>async</p>`);
    requestAnimationFrame(async () => {
      await customElements.whenDefined('wd-never-defined');
      this.setAttribute('data-ready', '');
    });
  }
}
class WaitPlain extends HTMLElement {
  connectedCallback() {
    init(this, { mode: 'open' });
    render(() => html`<p>plain</p>`);
    requestAnimationFrame(() => new Promise(() => {}));
  }
}
customElements.define('wait-returned', WaitReturned);
customElements.define('wait-async', WaitAsync);
customElements.define('wait-plain', WaitPlain);
export default WaitReturned;
