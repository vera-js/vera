import { init, html } from '@verajs/core';
export default class AsyncLifecycleSsr extends HTMLElement {
  async connectedCallback() {
    /** The await comes BEFORE `init()`: setup is synchronous, and a hook or render() after an await throws (no-owner). */
    await Promise.resolve();
    init({ host: this, shadow: 'open' }, () => {
      return () => html`<p>after await</p>`;
    });
  }
}
customElements.define('async-lifecycle-ssr', AsyncLifecycleSsr);
