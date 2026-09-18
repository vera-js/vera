import { init, render, html } from '@verajs/core';
export default class S extends HTMLElement {
  connectedCallback() { init(this); render(() => html`<p><slot name="h"></slot></p>`); }
}
customElements.define('hydrated-7', S);
