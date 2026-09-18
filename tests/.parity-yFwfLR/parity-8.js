import { init, render, html } from '@verajs/core';
export default class S extends HTMLElement {
  connectedCallback() { init(this); render(() => html`<p><slot name="h">no-h</slot><template><i>t</i></template></p>`); }
}
customElements.define('parity-8', S);
