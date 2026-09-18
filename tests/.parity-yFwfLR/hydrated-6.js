import { init, render, html } from '@verajs/core';
export default class S extends HTMLElement {
  connectedCallback() { init(this); render(() => html`<slot name="h">no-h</slot>`); }
}
customElements.define('hydrated-6', S);
