import { init, html } from '@verajs/core';
customElements.define('inert-mark', class extends HTMLElement {
  connectedCallback() { init({ host: this, shadow: 'open' }, () => {
    return () => html`<b>MARK</b>`;
  }); }
});
export default class InertSsr extends HTMLElement {
  connectedCallback() {
    init({ host: this, shadow: 'open' }, () => {
      return () => html`<div><template id="t"><inert-mark></inert-mark></template><inert-mark></inert-mark></div>`;
    });
  }
}
customElements.define('inert-ssr', InertSsr);
