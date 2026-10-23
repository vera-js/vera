/** A layout effect settles state after the template drew it — once a server divergence, now reaching the markup through both chains. */
import { init, html, createStore, effect } from '@verajs/core';
export default class LayoutEffect extends HTMLElement {
  connectedCallback() {
    const state = createStore({ label: 'start' });
    init({ host: this, shadow: 'open' }, () => {
      effect(() => { if (state.label === 'start') state.label = 'layout-ran'; }, { timing: 'layout' });
      return () => html`<p>${state.label}</p>`;
    });
    state.label = 'start';
  }
}
customElements.define('layout-effect', LayoutEffect);
