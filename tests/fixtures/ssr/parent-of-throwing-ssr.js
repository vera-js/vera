import './render-throws-ssr.js';
import { init, render, html } from '@verajs/core';
export default class ParentOfThrowingSsr extends HTMLElement {
  connectedCallback() {
    init(this, { mode: 'open' });
    render(() => html`<div><render-throws-ssr></render-throws-ssr></div>`);
  }
}
customElements.define('parent-of-throwing-ssr', ParentOfThrowingSsr);
