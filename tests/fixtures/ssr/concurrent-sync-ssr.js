/**
 * SSR fixture whose output is entirely determined by its attributes.
 *
 * The **synchronous** half of the pair used by `tests/ssr-concurrency-fuzz.test.mjs`. Its
 * `connectedCallback` does not suspend, because `renderToString` refuses one that does — its markup
 * would be empty, and it says so rather than serving it.
 *
 * Kept identical to `concurrent-async-ssr.js` in every other respect, so a difference between the two
 * entry points cannot be a difference between the components.
 */
import { init, createStore, render, html } from '@verajs/core';

export default class ConcurrentProbeSync extends HTMLElement {
  connectedCallback() {
    init(this, { mode: 'open' });
    const marker = this.getAttribute('marker') ?? 'none';
    const depth = Number(this.getAttribute('depth') ?? '1');

    /** No suspension: this one is for the synchronous entry point, which refuses an async callback. */


    const state = createStore({ marker, rows: Array.from({ length: depth }, (_, i) => `${marker}-${i}`) });

    render(
      () => html`
        <section data-marker=${state.marker}>
          <h1>${state.marker}</h1>
          <ul>
            ${state.rows.map((row) => html`<li>${row}</li>`)}
          </ul>
        </section>
      `
    );
  }
}

customElements.define('concurrent-probe-sync', ConcurrentProbeSync);
