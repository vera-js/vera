import { init, html, createStore } from '../../../../../packages/core/dist/development/vera.js';

/** A real Vera component, so the integration under test is the real one. */
customElements.define(
  'lazy-child',
  class extends HTMLElement {
    connectedCallback() {
      init({ host: this, shadow: 'open' }, () => {
        const state = createStore({ clicks: 0 });
        return () => html`<button @click=${() => state.clicks++}>child ${state.clicks}</button>`;
      });
    }
  }
);
