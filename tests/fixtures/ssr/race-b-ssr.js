import { init, html } from '@verajs/core';
export default class RaceBSsr extends HTMLElement {
  connectedCallback() { init({ host: this, shadow: 'open' }, () => {
    return () => html`<p>B</p>`;
  }); }
}
customElements.define('race-b-ssr', RaceBSsr);
