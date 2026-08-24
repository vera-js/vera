import { init, render, html, css } from '@verajs/core';
/** Selectors that carry characters escapeHtml would mangle. */
customElements.define('css-string', class extends HTMLElement {
  static styles = '.a > .b { color: red } .c[x="y"] { color: blue } .d::after { content: "&" }';
  connectedCallback() { init(this, { mode: 'open' }); render(() => html`<p>s</p>`); }
});
export default class CssSelectorsSsr extends HTMLElement {
  static styles = css`.a > .b { color: red } .c[x="y"] { color: blue }`;
  connectedCallback() { init(this, { mode: 'open' }); render(() => html`<p>c</p>`); }
}
customElements.define('cssselectors-ssr', CssSelectorsSsr);
