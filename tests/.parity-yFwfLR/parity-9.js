import { init, render, html } from '@verajs/core';
export default class S extends HTMLElement {
  connectedCallback() { init(this); render(() => html`<p><slot name="h">no-h</slot></p>`); }
}
customElements.define('parity-9', S);
