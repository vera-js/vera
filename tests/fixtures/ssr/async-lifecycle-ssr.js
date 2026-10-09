import { init, render, html } from '@verajs/core';
export default class AsyncLifecycleSsr extends HTMLElement {
  async connectedCallback() {
    /** The await comes BEFORE `init()`: setup is synchronous, and a hook or render() after an await throws (no-owner). */
    await Promise.resolve();
    init(this, { mode: 'open' });
    render(() => html`<p>after await</p>`);
  }
}
customElements.define('async-lifecycle-ssr', AsyncLifecycleSsr);
