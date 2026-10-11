import { init, html } from '@verajs/core';
const ref = { value: null };
export default class ElemPosSsr extends HTMLElement {
  connectedCallback() {
    init({ host: this, shadow: 'open' }, () => {
      return () => html`<div ${ref}>ref at element position</div>`;
    });
  }
}
customElements.define('elempos-ssr', ElemPosSsr);
