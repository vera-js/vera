import { init, html } from '@verajs/core';
import { css } from '@verajs/styles';
/** Selectors that carry characters escapeHtml would mangle. */
customElements.define('css-string', class extends HTMLElement {
  static styles = '.a > .b { color: red } .c[x="y"] { color: blue } .d::after { content: "&" }';
  connectedCallback() { init({ host: this, shadow: 'open' }, () => {
    return () => html`<p>s</p>`;
  }); }
});
export default class CssSelectorsSsr extends HTMLElement {
  static styles = css`.a > .b { color: red } .c[x="y"] { color: blue }`;
  connectedCallback() { init({ host: this, shadow: 'open' }, () => {
    return () => html`<p>c</p>`;
  }); }
}
customElements.define('cssselectors-ssr', CssSelectorsSsr);
