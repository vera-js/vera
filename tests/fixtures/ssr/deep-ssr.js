import { init, render, html } from '@verajs/core';
/** A chain: each level renders the next, down to `depth`. */
for (let level = 0; level < 24; level++) {
  const next = level + 1;
  customElements.define(`deep-${level}`, class extends HTMLElement {
    connectedCallback() {
      init(this, { mode: 'open' });
      render(() => (next < 24 ? html`<div><deep-${'x'}></deep-${'x'}></div>` : html`<i>leaf</i>`));
    }
  });
}
export default customElements.get('deep-0');
