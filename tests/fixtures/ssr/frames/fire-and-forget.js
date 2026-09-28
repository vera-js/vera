import { init, render, html, createStore } from '@verajs/core';

/** A frame starts work two microtasks deep and returns nothing — the async drain must still catch it. */
export default class FireAndForget extends HTMLElement {
  connectedCallback() {
    init(this, { mode: 'open' });
    const state = createStore({ text: 'early' });
    requestAnimationFrame(() => {
      Promise.resolve()
        .then(() => null)
        .then(() => {
          state.text = 'late';
        });
    });
    render(() => html`<p>${state.text}</p>`);
  }
}
customElements.define('fire-and-forget', FireAndForget);
