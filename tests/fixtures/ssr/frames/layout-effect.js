/** A layout effect settles state after the template drew it — once a server divergence, now reaching the markup through both chains. */
import { init, html, createStore, useLayoutEffect } from '@verajs/core';
export default class LayoutEffect extends HTMLElement {
  connectedCallback() {
    const state = createStore({ label: 'start' });
    init({ host: this, shadow: 'open' }, () => {
      useLayoutEffect(() => { if (state.label === 'start') state.label = 'layout-ran'; });
      return () => html`<p>${state.label}</p>`;
    });
    state.label = 'start';
  }
}
customElements.define('layout-effect', LayoutEffect);
