import { init, html } from '@verajs/core';
import { css } from '@verajs/styles';
export default class ClosedSsr extends HTMLElement {
  static styles = css`.c { color: red }`;
  connectedCallback() { init({ host: this, shadow: 'closed' }, () => {
    return () => html`<p>closed</p>`;
  }); }
}
customElements.define('closed-ssr', ClosedSsr);
