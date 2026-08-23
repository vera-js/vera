import { init, render, html } from '@verajs/core';
const ref = { value: null };
export default class ElemPosSsr extends HTMLElement {
  connectedCallback() {
    init(this, { mode: 'open' });
    render(() => html`<div ${ref}>ref at element position</div>`);
  }
}
customElements.define('elempos-ssr', ElemPosSsr);
