import { init, render, html } from '@verajs/core';
export default class S extends HTMLElement {
  connectedCallback() { init(this, { mode: 'open' }); render(() => html`<slot name="h">no-h</slot>`); }
}
customElements.define('shadow-parity-6', S);
