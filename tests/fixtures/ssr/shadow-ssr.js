import { init, render, html } from '@verajs/core';
import { spread } from '@verajs/spread';
export default class ShadowSsr extends HTMLElement {
  connectedCallback() {
    init(this, { mode: 'open' });
    render(() => html`<input type="text" disabled id='keep' lang=en ${spread({
      type: 'number', '?disabled': false, title: 'added', id: null,
    })} />`);
  }
}
customElements.define('shadow-ssr', ShadowSsr);
