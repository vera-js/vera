import { init, html, createStore } from '@verajs/core';

/** A component in R1's one form — `init(host, setup)`, the setup returning its render — for tests/core-setup-hydrate. */
customElements.define('setup-form-ssr', class extends HTMLElement {
  connectedCallback() {
    init(this, () => {
      const state = createStore({ n: 1 });
      return () => html`<p>count ${state.n}</p><button>go</button>`;
    });
  }
});
