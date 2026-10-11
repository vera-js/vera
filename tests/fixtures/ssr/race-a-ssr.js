import { init, html } from '@verajs/core';
export default class RaceASsr extends HTMLElement {
  connectedCallback() { init({ host: this, shadow: 'open' }, () => {
    return () => html`<p>A</p>`;
  }); }
}
customElements.define('race-a-ssr', RaceASsr);
