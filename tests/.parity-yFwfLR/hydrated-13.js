import { init, render, html } from '@verajs/core';
export default class S extends HTMLElement {
  connectedCallback() { init(this); render(() => html`<main><slot>no-d</slot></main>`); }
}
customElements.define('hydrated-13', S);
