import { init, render, html } from '@verajs/core';
export default class S extends HTMLElement {
  connectedCallback() { init(this); render(() => html`<article><header><slot name="h">no-h</slot></header><main><slot>no-d</slot></main></article>`); }
}
customElements.define('parity-1', S);
