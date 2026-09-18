import { init, render, html } from '@verajs/core';
export default class S extends HTMLElement {
  connectedCallback() { init(this, { mode: 'open' }); render(() => html`<p><slot name="h"></slot></p>`); }
}
customElements.define('shadow-parity-7', S);
