/**
 * SSR fixture whose output is entirely determined by its attributes.
 *
 * The **asynchronous** half of the pair used by `tests/ssr-concurrency-fuzz.test.mjs`.
 *
 * The suspension is the point: `renderToStringAsync` awaits `connectedCallback`, and the per-render
 * bookkeeping in `@verajs/ssr` is module-level, so a render that pauses is a render another could
 * interleave with. If the turn queue ever stopped covering both entry points, the marker below would
 * come back attached to the wrong request.
 */
import { init, createStore, render, html } from '@verajs/core';

export default class ConcurrentProbe extends HTMLElement {
  async connectedCallback() {
    init(this, { mode: 'open' });
    const marker = this.getAttribute('marker') ?? 'none';
    const depth = Number(this.getAttribute('depth') ?? '1');

    /** Suspends, giving any other render in flight a window to interleave. */
    await new Promise((resolve) => setTimeout(resolve, depth % 3));

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

customElements.define('concurrent-probe', ConcurrentProbe);
