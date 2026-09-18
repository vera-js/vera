import { init, render, html } from '@verajs/core';
export default class S extends HTMLElement {
  connectedCallback() { init(this); render(() => html`<header><slot name="h">no-h</slot></header>`); }
}
customElements.define('hydrated-4', S);
