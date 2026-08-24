import { init, render, html } from '@verajs/core';
customElements.define('inert-mark', class extends HTMLElement {
  connectedCallback() { init(this, { mode: 'open' }); render(() => html`<b>MARK</b>`); }
});
export default class InertSsr extends HTMLElement {
  connectedCallback() {
    init(this, { mode: 'open' });
    render(() => html`<div><template id="t"><inert-mark></inert-mark></template><inert-mark></inert-mark></div>`);
  }
}
customElements.define('inert-ssr', InertSsr);
