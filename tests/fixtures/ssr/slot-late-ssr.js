import { init, html } from '@verajs/core';
/** A light component that renders NO `<slot>` in its server state; one appears in a later state. */
export class SlotLateSsr extends HTMLElement {
  connectedCallback() {
    init(this, () => {
      return () => html`<header>HEAD</header><div class="body">${null}</div><footer>FOOT</footer>`;
    });
  }
}
customElements.define('slot-late-ssr', SlotLateSsr);
