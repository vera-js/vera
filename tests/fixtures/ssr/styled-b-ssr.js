import { init, render, html } from '@verajs/core';
import { css } from '@verajs/styles';

export default class StyledBSsr extends HTMLElement {
  static styles = css`.b { color: blue }`;
  connectedCallback() { init(this); render(() => html`<p>b</p>`); }
}
customElements.define('styled-b-ssr', StyledBSsr);
