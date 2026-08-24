import { init, render, html, css } from '@verajs/core';
export default class ClosedSsr extends HTMLElement {
  static styles = css`.c { color: red }`;
  connectedCallback() { init(this, { mode: 'closed' }); render(() => html`<p>closed</p>`); }
}
customElements.define('closed-ssr', ClosedSsr);
