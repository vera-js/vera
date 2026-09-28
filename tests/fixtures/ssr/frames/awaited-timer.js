import { init, render, html, createStore } from '@verajs/core';

/** A frame callback that awaits a TIMER — work the markup depends on, returned as a promise. */
export default class AwaitedTimer extends HTMLElement {
  connectedCallback() {
    init(this, { mode: 'open' });
    const state = createStore({ text: 'early' });
    requestAnimationFrame(async () => {
      await new Promise((resolve) => setTimeout(resolve, 5));
      state.text = 'late';
    });
    render(() => html`<p>${state.text}</p>`);
  }
}
customElements.define('awaited-timer', AwaitedTimer);
