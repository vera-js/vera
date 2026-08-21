import { html, init, render } from '@verajs/core';

customElements.define(
  'name-acquire',
  class extends HTMLElement {
    connectedCallback() {
      init(this);
      render(() => html`<p>Hello ${this.store?.name}</p>`);
    }
  }
);
