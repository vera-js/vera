import { init, render, html, createStore, useEffect } from '@verajs/core';
export default class StatefulSsr extends HTMLElement {
  connectedCallback() {
    init(this, { mode: 'open' });
    const state = createStore({ n: 1 });
    useEffect(() => void state.n);
    render(() => html`<p>${state.n}</p>`);
  }
}
customElements.define('stateful-ssr', StatefulSsr);
