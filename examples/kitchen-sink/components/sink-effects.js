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
    const state = createStore({ n: 0, report: 'press a button' });
    /** Untracked on purpose — see the header. */
    const counts = { sync: 0, coalesced: 0, layout: 0, lastProp: '', batched: 0 };
    /** Where the counters stood when the last press began, so a press can report its own deltas. */
    let mark = { sync: 0, coalesced: 0, layout: 0 };
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
      if (signal?.changed) counts.batched = signal.changed.size;
      /**
       * Published from here because `useEffect` runs **after** the render, so a template reading the
       * counters directly always shows this pass's `useEffect` count one behind. Writing a value the
       * template does read — and that this effect never reads — schedules one more render, which
       * then shows the finished numbers. No loop: the only dependency is `state.n`.
       */
      state.report =
        `useSyncEffect +${counts.sync - mark.sync}, ` +
        `useEffect +${counts.coalesced - mark.coalesced}, ` +
        `useLayoutEffect +${counts.layout - mark.layout}`;
    });
    useSyncEffect(() => {
      deps(state.n);
      counts.sync++;
    });

    /** Marks the counters before writing, so what the press caused can be reported on its own. */
    this.bump = (times = 1) => {
      mark = { sync: counts.sync, coalesced: counts.coalesced, layout: counts.layout };
      for (let i = 0; i < times; i++) state.n++;
    };

    render(
      () => html`<section id="effects">
        <h2>Effects</h2>
        <h3>useSyncEffect observes every individual write; useEffect observes one batch per frame</h3>
        <h4>Press each button once and read "that press caused" — the same three writes batch differently.</h4>
        <button id="bumpThree" @click=${() => this.bump(3)}>three writes in one turn</button>
        <button id="bumpOne" @click=${() => this.bump(1)}>one write</button>
        <p><strong>that press caused: <span id="report">${state.report}</span></strong></p>
        <p class="note">
          Pressing "one write" three times is three separate turns, so all three counters rise by
          three — which is the same framework behaviour, not a different one.
        </p>
        <p>n: <span id="n">${state.n}</span></p>
        <p>useSyncEffect runs: <span id="sync">${counts.sync}</span></p>
        <p>useEffect runs: <span id="coalesced">${counts.coalesced}</span></p>
        <p>useLayoutEffect runs: <span id="layout">${counts.layout}</span></p>
        <p>last changed: <span id="lastProp">${counts.lastProp}</span></p>
      </section>`
    );
  }
}

customElements.define('sink-effects', SinkEffects);
