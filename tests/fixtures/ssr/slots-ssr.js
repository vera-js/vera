import { init, render, html } from '@verajs/core';
export default class SlotsSsr extends HTMLElement {
  connectedCallback() {
    init(this, { mode: 'open' });
    render(() => html`<div><slot name="head"></slot><slot></slot><template id="tpl"><p>inert</p></template></div>`);
  }
}
customElements.define('slots-ssr', SlotsSsr);
