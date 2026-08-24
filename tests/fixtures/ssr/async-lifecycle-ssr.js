import { init, render, html } from '@verajs/core';
export default class AsyncLifecycleSsr extends HTMLElement {
  async connectedCallback() {
    init(this, { mode: 'open' });
    await Promise.resolve();
    render(() => html`<p>after await</p>`);
  }
}
customElements.define('async-lifecycle-ssr', AsyncLifecycleSsr);
