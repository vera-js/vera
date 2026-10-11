import { init, html } from '@verajs/core';
import { spread } from '@verajs/renderer/spread';
export default class ShadowSsr extends HTMLElement {
  connectedCallback() {
    init({ host: this, shadow: 'open' }, () => {
      return () => html`<input type="text" disabled id='keep' lang=en ${spread({
      type: 'number', '?disabled': false, title: 'added', id: null,
    })} />`;
    });
  }
}
customElements.define('shadow-ssr', ShadowSsr);
