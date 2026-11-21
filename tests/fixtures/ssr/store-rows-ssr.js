import { init, html, createStore } from '@verajs/core';

/**
 * The store-heavy SSR bench fixture: the same 100-row table as `rows-ssr.js`, but its rows live in a `createStore`, so
 * every `row.id` and `row.label` the render reads is a tracked store read: 300 per render (`row.id` twice, `row.label`
 * once, per row), where `rows-ssr.js`'s one signal makes none. It is the page shape `static: true` exists for, measured
 * beside the other fixtures in `bench/ssr.mjs`.
 */
export default class StoreRowsSsr extends HTMLElement {
  connectedCallback() {
    init({ host: this, shadow: 'open' }, () => {
      const state = createStore({ rows: Array.from({ length: 100 }, (_, i) => ({ id: i, label: `row ${i} <safe>` })) });
      return () => html`
        <table>
          <tbody>
            ${state.rows.map(
              (row) => html`<tr class=${row.id % 2 ? 'odd' : 'even'}><td>${row.id}</td><td>${row.label}</td></tr>`
            )}
          </tbody>
        </table>
      `;
    });
  }
}
customElements.define('store-rows-ssr', StoreRowsSsr);
