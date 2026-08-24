/**
 * `static styles` with **no shadow root** — hoisted to the document once per class, wrapped in
 * `@scope (sink-scoped) { … }`.
 *
 * The light-DOM path is the one `@verajs/styles` gets wrong most easily: it hoists per class rather
 * than per element, so a second instance must add nothing, and the scope wrapper is what keeps the
 * rules off the rest of the page. Server-side the same CSS comes back on `styles` rather than in
 * the markup, which is what a page shell is expected to place.
 */
import { init, render, html, css } from '@verajs/core';

export default class SinkScoped extends HTMLElement {
  static styles = css`
    .scoped {
      color: rgb(0, 128, 0);
    }
  `;

  connectedCallback() {
    init(this);
    render(() => html`<p class="scoped">scoped to the tag</p>`);
  }
}

customElements.define('sink-scoped', SinkScoped);
