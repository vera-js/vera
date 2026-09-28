/** A layout effect settles state after the template drew it — the case lifecycle-parity pins as a server divergence. */
import { init, render, html, createStore, useLayoutEffect } from '@verajs/core';
export default class LayoutEffect extends HTMLElement {
  connectedCallback() {
    init(this, { mode: 'open' });
    const state = createStore({ label: 'start' });
    useLayoutEffect(() => { if (state.label === 'start') state.label = 'layout-ran'; });
    render(() => html`<p>${state.label}</p>`);
    state.label = 'start';
  }
}
customElements.define('layout-effect', LayoutEffect);
