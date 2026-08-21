import { html, init, render } from '@verajs/core';

class ChildElement extends HTMLElement {
  connectedCallback() {
    init(this);
    render(() => html`<p>${this.item?.message}</p>`);
  }
}

customElements.define('child-element', ChildElement);
