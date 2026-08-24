/** The JSX twin of `../components/sink-slots.js`. */
import { init, render, html } from '@verajs/core';

export default class SinkSlots extends HTMLElement {
  connectedCallback() {
    init(this, { mode: 'open' });
    render(() => (
      <section id="slots">
        <header><slot name="title">untitled</slot></header>
        <div id="body"><slot>nothing slotted</slot></div>
        <footer><slot name="never">fallback only</slot></footer>
      </section>
    ));
    void html;
  }
}

customElements.define('sink-slots', SinkSlots);
