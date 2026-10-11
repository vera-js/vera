import { init, html, createStore, useEffect } from '@verajs/core';

/** Settles in five self-scheduled steps: two runs per flush, so its later runs are HELD for a frame (the scheduler's loop rule). */
class SelfSettling extends HTMLElement {
  connectedCallback() {
    init({ host: this, shadow: 'open' }, () => {
      const state = createStore({ n: 1 });
      useEffect(() => {
        if (state.n < 5) state.n++;
      });
      return () => html`<p>settled-${state.n}</p>`;
    });
  }
}

customElements.define('self-settling', SelfSettling);
export default SelfSettling;
