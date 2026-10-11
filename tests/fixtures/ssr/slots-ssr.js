import { init, html } from '@verajs/core';
export default class SlotsSsr extends HTMLElement {
  connectedCallback() {
    init({ host: this, shadow: 'open' }, () => {
      return () => html`<div><slot name="head"></slot><slot></slot><template id="tpl"><p>inert</p></template></div>`;
    });
  }
}
customElements.define('slots-ssr', SlotsSsr);
