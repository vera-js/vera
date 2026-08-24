import { init, render, html, css } from '@verajs/core';
customElements.define('injected-comp', class extends HTMLElement {
  connectedCallback() { init(this, { mode: 'open' }); render(() => html`<b>INJECTED</b>`); }
});
export default class CssTagnameSsr extends HTMLElement {
  /** CSS that merely mentions a registered tag inside a string. */
  static styles = css`.x::after { content: "<injected-comp>" }`;
  connectedCallback() { init(this, { mode: 'open' }); render(() => html`<p>styled</p>`); }
}
customElements.define('css-tagname-ssr', CssTagnameSsr);
