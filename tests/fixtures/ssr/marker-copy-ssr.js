import { init, html } from '@verajs/core';

/**
 * A component that copies a pending child's attributes — its instance marker included — onto a
 * DIFFERENT tag, ahead of the original so the scan meets the copy first. The marker must only ever
 * produce the component it was written for.
 */
customElements.define('copy-a', class extends HTMLElement {
  connectedCallback() {
    init({ host: this, shadow: 'open' }, () => {
      return () => html`<b>A:${this.v}</b>`;
    });
  }
});
customElements.define('copy-b', class extends HTMLElement {
  connectedCallback() {
    init({ host: this, shadow: 'open' }, () => {
      return () => html`<i>B</i>`;
    });
  }
});
export default class MarkerCopySsr extends HTMLElement {
  connectedCallback() {
    init({ host: this, shadow: 'open' }, () => {
      return () => html`<copy-a .v=${7}></copy-a>`;
    });
    const a = this.shadowRoot.querySelector('copy-a');
    const b = document.createElement('copy-b');
    this.shadowRoot.prepend(b);
    /** And onto a second `copy-a`, after the original: one instance is rendered once, never twice. */
    const twin = document.createElement('copy-a');
    this.shadowRoot.append(twin);
    for (const { name, value } of a.attributes) {
      b.setAttribute(name, value);
      twin.setAttribute(name, value);
    }
  }
}
customElements.define('marker-copy-ssr', MarkerCopySsr);
