import { init, render, html } from '@verajs/core';
import { css } from '@verajs/styles';
export default class ClosedSsr extends HTMLElement {
  static styles = css`.c { color: red }`;
  connectedCallback() { init(this, { mode: 'closed' }); render(() => html`<p>closed</p>`); }
}
customElements.define('closed-ssr', ClosedSsr);
