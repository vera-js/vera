import { init, html, createStore, useEffect } from '@verajs/core';
export default class StatefulSsr extends HTMLElement {
  connectedCallback() {
    init({ host: this, shadow: 'open' }, () => {
      const state = createStore({ n: 1 });
      useEffect(() => void state.n);
      return () => html`<p>${state.n}</p>`;
    });
  }
}
customElements.define('stateful-ssr', StatefulSsr);
