import { init, createStore, html } from '@verajs/core';
import './child-badge.js';

export default class NestedSsr extends HTMLElement {
  static styles = 'h2 { color: teal }';
  connectedCallback() {
    init({ host: this, shadow: 'open' }, () => {
      const state = createStore({ items: ['a <b>', 'c'] });
      return () => html`
        <h2 @click=${() => {}} onClick=${() => {}}>nested</h2>
        <ul>${state.items.map((item) => html`<li>${item}</li>`)}</ul>
        <child-badge label="from-parent"></child-badge>
      `;
    });
  }
}
customElements.define('nested-ssr', NestedSsr);
