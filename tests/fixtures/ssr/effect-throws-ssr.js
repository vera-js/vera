import { init, render, html, useEffect, createStore } from '@verajs/core';
export default class EffectThrowsSsr extends HTMLElement {
  connectedCallback() {
    init(this, { mode: 'open' });
    const state = createStore({ n: 1 });
    useEffect(() => {
      if (state.n === 2) throw new Error('effect blew up');
    });
    render(() => html`<p>${state.n}</p>`);
    state.n = 2;
  }
}
customElements.define('effect-throws-ssr', EffectThrowsSsr);
