import { init, render, html, createStore } from '@verajs/core';

/** A component whose render reads a reactive Map — the collections insert exercised server-side. */
export default class MapDrivenSsr extends HTMLElement {
  connectedCallback() {
    init(this);
    this.store = createStore({ rows: new Map([['a', 1], ['b', 2]]) });
    render(() => html`<ul>${[...this.store.rows.entries()].map(([k, v]) => html`<li>${k}=${v}</li>`)}</ul>`);
  }
}
customElements.define('map-driven-ssr', MapDrivenSsr);
