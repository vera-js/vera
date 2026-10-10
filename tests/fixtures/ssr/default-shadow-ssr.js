import { init, html } from '@verajs/core';

/** A one-form component that names no root of its own — for tests/renderer-shadow-default (the app default reaches it). */
customElements.define('sd-card', class extends HTMLElement {
  connectedCallback() {
    init(this, () => () => html`<p>served</p>`);
  }
});
