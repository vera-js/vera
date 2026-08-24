/** The JSX twin of `../components/sink-slots.js`. */
import { init, render } from '@verajs/core';

export default class SinkSlots extends HTMLElement {
  connectedCallback() {
    init(this, { mode: 'open' });
    render(() => (
      <section id="slots">
        <h2>Slots</h2>
        <h3>Default, named and fallback content, filled from the light DOM the parent passed in</h3>
        <h4>Nothing to click. Each line names its slot; the last one shows a fallback, because nothing fills it.</h4>
        <p><code>slot name="title"</code> — filled by the parent: <header><slot name="title">untitled</slot></header></p>
        <p><code>slot</code>, the default — filled by the parent: <div id="body"><slot>nothing slotted</slot></div></p>
        <p><code>slot name="never"</code> — nothing fills it, so you see its fallback: <footer><slot name="never">fallback only</slot></footer></p>
      </section>
    ));
  }
}

customElements.define('sink-slots', SinkSlots);
