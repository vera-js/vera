import { init, render, html } from '@verajs/core';

/**
 * A component that copies a pending child's attributes — its instance marker included — onto a
 * DIFFERENT tag, ahead of the original so the scan meets the copy first. The marker must only ever
 * produce the component it was written for.
 */
customElements.define('copy-a', class extends HTMLElement {
  connectedCallback() {
    init(this, { mode: 'open' });
    render(() => html`<b>A:${this.v}</b>`);
  }
});
customElements.define('copy-b', class extends HTMLElement {
  connectedCallback() {
    init(this, { mode: 'open' });
    render(() => html`<i>B</i>`);
  }
});
export default class MarkerCopySsr extends HTMLElement {
  connectedCallback() {
    init(this, { mode: 'open' });
    render(() => html`<copy-a .v=${7}></copy-a>`);
    const a = this.shadowRoot.querySelector('copy-a');
    const b = document.createElement('copy-b');
    this.shadowRoot.prepend(b);
    for (const { name, value } of a.attributes) b.setAttribute(name, value);
  }
}
customElements.define('marker-copy-ssr', MarkerCopySsr);
