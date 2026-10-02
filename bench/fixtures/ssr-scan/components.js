import { init, render, html } from '@verajs/core';
class RowKid extends HTMLElement {
  connectedCallback() { init(this, { mode: 'open' }); render(() => html`<span class="kid">${this.getAttribute('label')}</span>`); }
}
customElements.define('row-kid', RowKid);
const rows = Array.from({ length: 100 }, (_, i) => ({ id: i, label: `row ${i}` }));
class BenchPage extends HTMLElement {
  connectedCallback() {
    init(this, { mode: 'open' });
    render(() => html`<table><tbody>${rows.map((r) => html`<tr data-id=${r.id}><td class="a" title="cell ${r.id}">${r.label}</td><!-- c --><td><row-kid label=${r.label}></row-kid></td></tr>`)}</tbody></table>`);
  }
}
customElements.define('bench-page', BenchPage);
export default BenchPage;
