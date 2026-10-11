import { init, html } from '@verajs/core';
customElements.define('combo-child', class extends HTMLElement {
  connectedCallback() { init({ host: this, shadow: 'open' }, () => {
    return () => html`<i>child</i>`;
  }); }
});
export default class ComboSsr extends HTMLElement {
  connectedCallback() {
    init({ host: this, shadow: 'open' }, () => {
      return () => html`<div><combo-child></combo-child><slot></slot></div>`;
    });
  }
}
customElements.define('combo-ssr', ComboSsr);
