import { init, html } from '@verajs/core';
import { css } from '@verajs/styles';
customElements.define('injected-comp', class extends HTMLElement {
  connectedCallback() { init({ host: this, shadow: 'open' }, () => {
    return () => html`<b>INJECTED</b>`;
  }); }
});
export default class CssTagnameSsr extends HTMLElement {
  /** CSS that merely mentions a registered tag inside a string. */
  static styles = css`.x::after { content: "<injected-comp>" }`;
  connectedCallback() { init({ host: this, shadow: 'open' }, () => {
    return () => html`<p>styled</p>`;
  }); }
}
customElements.define('css-tagname-ssr', CssTagnameSsr);
