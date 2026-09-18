import { init, render, html } from '@verajs/core';
export default class S extends HTMLElement {
  connectedCallback() { init(this); render(() => html`<p><slot name="a"><slot name="b">inner</slot></slot></p>`); }
}
customElements.define('parity-10', S);
