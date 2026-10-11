import { init, html } from '../../../../../packages/core/dist/development/vera.js';

customElements.define(
  'nested-grandchild',
  class extends HTMLElement {
    connectedCallback() {
      init({ host: this, shadow: 'open' }, () => {
        return () => html`<em>grandchild</em>`;
      });
    }
  }
);
