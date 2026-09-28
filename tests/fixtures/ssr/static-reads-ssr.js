import { init, render, html, createStore } from '@verajs/core';

/**
 * A store the static-mode suite counts reads on — `counted` is the flag its store module looks for.
 * Created per instance: a store's handler is decided on first use, and a module-level one would have
 * been decided by whichever render reached it first.
 */
export const reads = { count: 0 };

export default class StaticReadsSsr extends HTMLElement {
  connectedCallback() {
    init(this, { mode: 'open' });
    const state = createStore({ counted: true, label: 'counted' });
    render(() => html`<p>${state.label}</p>`);
  }
}
customElements.define('static-reads-ssr', StaticReadsSsr);
