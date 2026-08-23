import { init, render, html, createStore } from '../../../../../packages/core/dist/development/vera.js';

/** A real Vera component, so the integration under test is the real one. */
customElements.define(
  'lazy-child',
  class extends HTMLElement {
    connectedCallback() {
      init(this, { mode: 'open' });
      const state = createStore({ clicks: 0 });
      render(() => html`<button @click=${() => state.clicks++}>child ${state.clicks}</button>`);
    }
  }
);
