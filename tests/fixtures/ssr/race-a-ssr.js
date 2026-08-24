import { init, render, html } from '@verajs/core';
export default class RaceASsr extends HTMLElement {
  connectedCallback() { init(this, { mode: 'open' }); render(() => html`<p>A</p>`); }
}
customElements.define('race-a-ssr', RaceASsr);
