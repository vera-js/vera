import { init, render, html } from '@verajs/core';
customElements.define('mark-comp', class extends HTMLElement {
  connectedCallback() { init(this, { mode: 'open' }); render(() => html`<b>MARK</b>`); }
});
export default class AdversarialSsr extends HTMLElement {
  connectedCallback() {
    init(this, { mode: 'open' });
    render(() => html`
      <div id="a" title="a > b"><mark-comp></mark-comp></div>
      <mark-comp title="x > y"></mark-comp>
      <!-- <mark-comp></mark-comp> -->
      <textarea><mark-comp></mark-comp></textarea>
      <p>done</p>`);
  }
}
customElements.define('adversarial-ssr', AdversarialSsr);
