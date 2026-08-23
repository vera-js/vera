import { html, init, render } from '@verajs/core';

customElements.define(
  'name-acquire',
  class extends HTMLElement {
    /** Set from outside by whoever mounts this element. */
    declare store?: { name?: string };

    connectedCallback() {
      init(this);
      render(() => html`<p>Hello ${this.store?.name}</p>`);
    }
  }
);
