import { init, render, html, css } from '@verajs/core';
/** A theme value from somewhere untrusted, interpolated into `css` as the tag invites. */
const userColor = '</style><img src=x onerror="TAKEOVER()">';
export default class CssXssSsr extends HTMLElement {
  static styles = css`p { color: ${userColor}; }`;
  connectedCallback() {
    init(this, { mode: 'open' });
    render(() => html`<p>themed</p>`);
  }
}
customElements.define('cssxss-ssr', CssXssSsr);
