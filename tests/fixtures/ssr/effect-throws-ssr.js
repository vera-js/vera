import { init, html, useEffect, createStore } from '@verajs/core';
export default class EffectThrowsSsr extends HTMLElement {
  connectedCallback() {
    const state = createStore({ n: 1 });
    init({ host: this, shadow: 'open' }, () => {
      useEffect(() => {
        if (state.n === 2) throw new Error('effect blew up');
      });
      return () => html`<p>${state.n}</p>`;
    });
    state.n = 2;
  }
}
customElements.define('effect-throws-ssr', EffectThrowsSsr);
