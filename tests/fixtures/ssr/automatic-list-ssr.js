import { init, html, createStore, wire } from '@verajs/core';
import { lists } from '@verajs/renderer/keyed';

/**
 * The server half for tests/hydrate-automatic-lists (B4, 2026-10-22): a store-array `.map` of rows — plain `<li>`s and a
 * component row — with `lists` wired as shared setup would wire it (the server renders the rows plainly either way).
 */
wire([lists]);
customElements.define('al-row', class extends HTMLElement {
  connectedCallback() { init(this, () => () => html`<i>${this.item?.label}</i>`); }
});
customElements.define('automatic-list-ssr', class extends HTMLElement {
  connectedCallback() {
    init(this, () => {
      const s = createStore({ rows: [{ id: 1, label: 'a' }, { id: 2, label: 'b' }, { id: 3, label: 'c' }] });
      return () => html`<ul>${s.rows.map((r) => html`<li>${r.label}</li>`)}</ul><div>${s.rows.map((r) => html`<al-row .item=${r}></al-row>`)}</div>`;
    });
  }
});
