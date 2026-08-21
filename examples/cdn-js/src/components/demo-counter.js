import { init, createStore, render, useEffect } from '@verajs/core';
import { computed } from '../inserts/computed.js';
import { html } from 'lit-html';

/**
 * Loaded lazily by the autoloader — nothing imports this file. It is fetched the first time
 * `<demo-counter>` appears in a render, from `components/demo-counter.js`.
 *
 * Also demonstrates reactive collections: the `Map` below tracks per-key, out of the box —
 * `set`/`delete`/`clear` re-render subscribers of the touched keys (and `size`), and no-op
 * mutations are silent. Built into core; no wiring required.
 */
class DemoCounter extends HTMLElement {
  connectedCallback() {
    init(this, { mode: 'open' });

    const state = createStore({
      count: 0,
      /** A computed value via the example insert — reads as a plain property below. */
      doubled: computed(() => state.count * 2),
    });
    const tallies = createStore(new Map([['clicks', 0]]));

    useEffect(() => {
      console.log('count is now', state.count);
    });

    const increment = () => {
      state.count++;
      tallies.set('clicks', tallies.get('clicks') + 1);
    };

    render(
      () => html`
        <fieldset>
          <legend>demo-counter (autoloaded)</legend>
          <button @click=${increment}>Clicked ${state.count} times</button>
          <p>Reactive Map tally: ${tallies.get('clicks')} — doubled (computed): ${state.doubled}</p>
        </fieldset>
      `
    );
  }
}

customElements.define('demo-counter', DemoCounter);
