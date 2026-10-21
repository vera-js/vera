import { init, html } from '@verajs/core';
class LazySsr extends HTMLElement {
  connectedCallback() {
    init(this, async () => {
      const { doubled } = await import('./lazy.mjs');
      return () => html`<i>${doubled.value}</i>`;
    });
  }
}
if (!customElements.get('lazy-ssr')) customElements.define('lazy-ssr', LazySsr);
export default LazySsr;
