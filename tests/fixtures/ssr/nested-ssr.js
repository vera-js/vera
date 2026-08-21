import { init, createStore, render, html } from '@verajs/core';
import './child-badge.js';

export default class NestedSsr extends HTMLElement {
  static styles = 'h2 { color: teal }';
  connectedCallback() {
    init(this, { mode: 'open' });
    const state = createStore({ items: ['a <b>', 'c'] });
    render(
      () => html`
        <h2 @click=${() => {}} onClick=${() => {}}>nested</h2>
        <ul>${state.items.map((item) => html`<li>${item}</li>`)}</ul>
        <child-badge label="from-parent"></child-badge>
      `
    );
  }
}
customElements.define('nested-ssr', NestedSsr);
