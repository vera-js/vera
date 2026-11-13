import { init, html, createStore, wire } from '@verajs/core';
import { lists } from '@verajs/renderer/keyed';

/**
 * tests/core-lists-no-renderer's server case (D28): shared setup that wires `lists` ALONE (as automatic-list-ssr.js
 * does), plus a connector after it that counts the automatic lists built (`$M` calls) and whether a server turn was open
 * at each — the control that the case's "0 warnings" is a render that built Lists, not one that built none.
 */
const counted = (registry) => {
  const map = registry.$M;
  globalThis.__LISTS__ = { built: 0, inTurn: 0 };
  registry.$M = function (...args) {
    globalThis.__LISTS__.built++;
    if (registry.$ss?.(0)) globalThis.__LISTS__.inTurn++;
    return map.apply(this, args);
  };
};
wire([lists, counted]);
customElements.define('automatic-list-counted', class extends HTMLElement {
  connectedCallback() {
    init(this, () => {
      const s = createStore({ rows: [{ id: 1, label: 'a' }, { id: 2, label: 'b' }] });
      return () => html`<ul>${s.rows.map((r) => html`<li>${r.label}</li>`)}</ul>`;
    });
  }
});
