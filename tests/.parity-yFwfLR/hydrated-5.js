import { init, render, html } from '@verajs/core';
export default class S extends HTMLElement {
  connectedCallback() { init(this); render(() => html`<p><slot name="h">a</slot></p><p><slot name="h">b</slot></p>`); }
}
customElements.define('hydrated-5', S);
