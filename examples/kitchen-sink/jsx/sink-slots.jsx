/** The JSX twin of `../components/sink-slots.js`. */
import { init, render } from '@verajs/core';

export default class SinkSlots extends HTMLElement {
  connectedCallback() {
    init(this, { mode: 'open' });
    render(() => (
      <section id="slots">
        <h2>Slots</h2>
        <h3>Default, named and fallback content, filled from the light DOM the parent passed in</h3>
        <h4>Nothing to click. The footer reads "fallback only" because nothing fills that slot.</h4>
        <header><slot name="title">untitled</slot></header>
        <div id="body"><slot>nothing slotted</slot></div>
        <footer><slot name="never">fallback only</slot></footer>
      </section>
    ));
  }
}

customElements.define('sink-slots', SinkSlots);
