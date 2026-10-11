import { init, html } from '@verajs/core';
import { css } from '@verajs/styles';

customElements.define('light-child', class extends HTMLElement {
  static styles = css`.c { color: green }`;
  connectedCallback() {
    init(this, () => {
      this.setAttribute('data-child', '');
      return () => html`<i class="c">child</i>`;
    });
  }
});

export default class LightDomSsr extends HTMLElement {
  static styles = css`.p { color: red }`;
  connectedCallback() {
    init(this, () => {
      return () => html`<div class="p"><light-child></light-child></div>`;
    });
  }
}
customElements.define('light-dom-ssr', LightDomSsr);
