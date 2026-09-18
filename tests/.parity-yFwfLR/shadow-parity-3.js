import { init, render, html } from '@verajs/core';
export default class S extends HTMLElement {
  connectedCallback() { init(this, { mode: 'open' }); render(() => html`<header><slot name="h">no-h</slot></header>`); }
}
customElements.define('shadow-parity-3', S);
