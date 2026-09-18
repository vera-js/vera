import { init, render, html } from '@verajs/core';
import { props } from '@verajs/renderer/spread';

/** Reads everything a parent can deliver: an object, a `.value`-named prop, and an attribute. */
class PropsRow extends HTMLElement {
  connectedCallback() {
    init(this, { mode: 'open' });
    render(
      () =>
        html`<p>
          ${this.item ? this.item.label : 'no-item'} · ${this.value === undefined ? 'no-value' : String(this.value)} ·
          ${this.getAttribute('data-kind') ?? 'no-attr'} · ${this.live === undefined ? 'no-live' : String(this.live)}
        </p>`
    );
  }
}
customElements.define('props-row', PropsRow);

class PropsPage extends HTMLElement {
  connectedCallback() {
    init(this, { mode: 'open' });
    const rows = [{ label: 'alpha' }, { label: 'beta' }];
    render(
      () => html`
        <props-row .item=${{ label: 'written' }} .value=${7} !live=${true} data-kind="written"></props-row>
        <props-row ${props({ item: { label: 'spread' } })} data-kind="spread"></props-row>
        ${rows.map((item) => html`<props-row .item=${item}></props-row>`)}
        <props-unloaded .item=${{ label: 'client-only' }}></props-unloaded>
      `
    );
  }
}
customElements.define('props-page', PropsPage);
export default PropsPage;
