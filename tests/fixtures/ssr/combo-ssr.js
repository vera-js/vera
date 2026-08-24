import { init, render, html } from '@verajs/core';
customElements.define('combo-child', class extends HTMLElement {
  connectedCallback() { init(this, { mode: 'open' }); render(() => html`<i>child</i>`); }
});
export default class ComboSsr extends HTMLElement {
  connectedCallback() {
    init(this, { mode: 'open' });
    render(() => html`<div><combo-child></combo-child><slot></slot></div>`);
  }
}
customElements.define('combo-ssr', ComboSsr);
