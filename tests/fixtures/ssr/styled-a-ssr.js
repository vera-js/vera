import { init, html } from '@verajs/core';
import { css } from '@verajs/styles';

export default class StyledASsr extends HTMLElement {
  static styles = css`.a { color: red }`;
  connectedCallback() { init(this, () => {
    return () => html`<p>a</p>`;
  }); }
}
customElements.define('styled-a-ssr', StyledASsr);
