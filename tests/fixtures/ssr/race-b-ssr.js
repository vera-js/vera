import { init, render, html } from '@verajs/core';
export default class RaceBSsr extends HTMLElement {
  connectedCallback() { init(this, { mode: 'open' }); render(() => html`<p>B</p>`); }
}
customElements.define('race-b-ssr', RaceBSsr);
