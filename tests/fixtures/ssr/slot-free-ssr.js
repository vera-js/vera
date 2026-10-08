/** An ordinary server-rendered component — NO `<slot>` in its template — on a server with slots wired. */
import { init, render, html } from '@verajs/core';
export class SlotFreeSsr extends HTMLElement {
  connectedCallback() {
    init(this);
    render(() => html`<section><h1>Plain</h1><input value="server"><button>go</button></section>`);
  }
}
customElements.define('slot-free-ssr', SlotFreeSsr);
