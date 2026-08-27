import { init, render, html, shallowRef } from '@verajs/core';

/**
 * The larger SSR bench fixture: a 100-row table, the classic list-heavy page shape. Rows live in
 * a `shallowRef`, per the documented list guidance (llms.txt) — deep-proxying immutable rows is
 * the measured ~300x mistake, on the server exactly as on the client — see
 * `tests/perf-claims.test.mjs`, which asserts the ratio rather than a figure that drifts.
 */
export default class RowsSsr extends HTMLElement {
  connectedCallback() {
    init(this, { mode: 'open' });
    const state = shallowRef(Array.from({ length: 100 }, (_, i) => ({ id: i, label: `row ${i} <safe>` })));
    render(
      () => html`
        <table>
          <tbody>
            ${state.value.map(
              (row) => html`<tr class=${row.id % 2 ? 'odd' : 'even'}><td>${row.id}</td><td>${row.label}</td></tr>`
            )}
          </tbody>
        </table>
      `
    );
  }
}
customElements.define('rows-ssr', RowsSsr);
