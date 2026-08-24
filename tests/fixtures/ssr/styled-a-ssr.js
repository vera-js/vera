import { init, render, html, css } from '@verajs/core';

export default class StyledASsr extends HTMLElement {
  static styles = css`.a { color: red }`;
  connectedCallback() { init(this); render(() => html`<p>a</p>`); }
}
customElements.define('styled-a-ssr', StyledASsr);
