import { init, render, html, createStore } from '@verajs/core';

/**
 * A frame starts work `depth` microtasks deep and returns nothing — the async drain must still catch
 * it. The write schedules the re-render as a frame, which is what the drain's idle turns wait for.
 */
export default class FireAndForget extends HTMLElement {
  connectedCallback() {
    init(this, { mode: 'open' });
    const state = createStore({ text: 'early' });
    const depth = Number(this.getAttribute('depth') ?? 3);
    requestAnimationFrame(() => {
      let chain = Promise.resolve();
      for (let i = 1; i < depth; i++) chain = chain.then(() => null);
      chain.then(() => {
        state.text = 'late';
      });
    });
    render(() => html`<p>${state.text}</p>`);
  }
}
customElements.define('fire-and-forget', FireAndForget);
