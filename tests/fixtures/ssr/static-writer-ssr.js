/**
 * Writes to its store during the render, which `static: true` must refuse rather than render
 * markup that reflects none of it. Built for `tests/ssr-static-mode.test.mjs`.
 */
import { init, render, html, createStore } from '@verajs/core';

export default class StaticWriterSsr extends HTMLElement {
  connectedCallback() {
    init(this, { mode: 'open' });
    const state = createStore({ n: 1 });
    render(() => html`<p>${state.n}</p>`);
    state.n = 2;
  }
}
customElements.define('static-writer-ssr', StaticWriterSsr);
