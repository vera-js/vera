import { init, render, html } from '@verajs/core';
export default class S extends HTMLElement {
  connectedCallback() { init(this, { mode: 'open' }); render(() => html`<main><slot>no-d</slot></main>`); }
}
customElements.define('shadow-parity-11', S);
