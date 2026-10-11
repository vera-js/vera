import './render-throws-ssr.js';
import { init, html } from '@verajs/core';
export default class ParentOfThrowingSsr extends HTMLElement {
  connectedCallback() {
    init({ host: this, shadow: 'open' }, () => {
      return () => html`<div><render-throws-ssr></render-throws-ssr></div>`;
    });
  }
}
customElements.define('parent-of-throwing-ssr', ParentOfThrowingSsr);
