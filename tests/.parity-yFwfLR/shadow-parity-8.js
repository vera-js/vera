import { init, render, html } from '@verajs/core';
export default class S extends HTMLElement {
  connectedCallback() { init(this, { mode: 'open' }); render(() => html`<p><slot name="h">no-h</slot><template><i>t</i></template></p>`); }
}
customElements.define('shadow-parity-8', S);
