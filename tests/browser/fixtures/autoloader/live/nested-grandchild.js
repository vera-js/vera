import { init, render, html } from '../../../../../packages/core/dist/development/vera.js';

customElements.define(
  'nested-grandchild',
  class extends HTMLElement {
    connectedCallback() {
      init(this, { mode: 'open' });
      render(() => html`<em>grandchild</em>`);
    }
  }
);
