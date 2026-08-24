/**
 * The three effect kinds, their ordering, and the signal they receive.
 *
 * Counters live in a **plain object**, not the store. An effect that increments reactive state it
 * also reads re-triggers itself forever — the docs warn about it for `useSyncEffect` and it is just
 * as true of the other two. Server-side that is a stack overflow; in a browser it is a hang. So the
 * effects declare their dependency explicitly with `deps(state.n)` and write somewhere untracked,
 * which is also the only way the counts are deterministic enough to compare across three modes.
 *
 * Ordering is `useLayoutEffect` (25) → render (50) → `useEffect` (75), so a render triggered by `n`
 * shows the layout count including this pass and the coalesced count from the pass before. That is
 * the contract, and rendering both is how a test sees it.
 */
import { init, render, html, createStore, useEffect, useLayoutEffect, useSyncEffect, deps } from '@verajs/core';

export default class SinkEffects extends HTMLElement {
  connectedCallback() {
    init(this, { mode: 'open' });
    const state = createStore({ n: 0 });
    /** Untracked on purpose — see the header. */
    const counts = { sync: 0, coalesced: 0, layout: 0, lastProp: '', batched: 0 };
    this.state = state;
    this.counts = counts;

    useLayoutEffect(() => {
      deps(state.n);
      counts.layout++;
    });
    useEffect((signal) => {
      deps(state.n);
      counts.coalesced++;
      if (signal?.prop) counts.lastProp = String(signal.prop);
      /** `signal.changed` is only present on a coalesced run, and carries the whole batch. */
      if (signal?.changed) counts.batched = signal.changed.size;
    });
    useSyncEffect(() => {
      deps(state.n);
      counts.sync++;
    });

    /** Driven by a test: three writes in a row separate the coalesced counters from the sync one. */
    this.bump = (times = 1) => {
      for (let i = 0; i < times; i++) state.n++;
    };

    render(
      () => html`<section id="effects">
        <p id="n">${state.n}</p>
        <p id="sync">${counts.sync}</p>
        <p id="coalesced">${counts.coalesced}</p>
        <p id="layout">${counts.layout}</p>
        <p id="lastProp">${counts.lastProp}</p>
      </section>`
    );
  }
}

customElements.define('sink-effects', SinkEffects);
