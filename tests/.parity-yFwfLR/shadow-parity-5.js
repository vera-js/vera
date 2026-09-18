import { init, render, html } from '@verajs/core';
export default class S extends HTMLElement {
  connectedCallback() { init(this, { mode: 'open' }); render(() => html`<p><slot name="h">a</slot></p><p><slot name="h">b</slot></p>`); }
}
customElements.define('shadow-parity-5', S);
