/**
 * SSR fixture: a real Vera component (init + createStore + render) in wc-compiler's expected
 * entry shape (default-exported class). Rendered server-side by tests/ssr-native.test.mjs through the
 * strategy-2 renderer (@verajs/ssr).
 */
import { init, createStore, html } from '@verajs/core';

export default class HelloSsr extends HTMLElement {
  connectedCallback() {
    init({ host: this, shadow: 'open' }, () => {
      const state = createStore({ greeting: 'hello from the server', count: 3 });
      return () => html`
        <section class="wrap">
          <h1>${state.greeting}</h1>
          <output ?hidden=${state.count === 0}>count: ${state.count}</output>
          <input .value=${state.greeting} />
        </section>
      `;
    });
  }
}

customElements.define('hello-ssr', HelloSsr);
