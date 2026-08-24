import { init, render, html, css } from '@verajs/core';

customElements.define('light-child', class extends HTMLElement {
  static styles = css`.c { color: green }`;
  connectedCallback() {
    init(this);
    this.setAttribute('data-child', '');
    render(() => html`<i class="c">child</i>`);
  }
});

export default class LightDomSsr extends HTMLElement {
  static styles = css`.p { color: red }`;
  connectedCallback() {
    init(this);
    render(() => html`<div class="p"><light-child></light-child></div>`);
  }
}
customElements.define('light-dom-ssr', LightDomSsr);
