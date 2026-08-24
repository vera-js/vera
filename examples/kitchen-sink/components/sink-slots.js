/**
 * Slots: default, named, and fallback content for a slot nothing fills.
 *
 * Light-DOM children are what a server hands over as `children` and what a browser's parser has
 * already built by the time an element upgrades — the same content arriving two ways, which is
 * exactly where the two sides have disagreed before.
 */
import { init, render, html } from '@verajs/core';

export default class SinkSlots extends HTMLElement {
  connectedCallback() {
    init(this, { mode: 'open' });
    render(
      () => html`<section id="slots">
        <header><slot name="title">untitled</slot></header>
        <div id="body"><slot>nothing slotted</slot></div>
        <footer><slot name="never">fallback only</slot></footer>
      </section>`
    );
  }
}

customElements.define('sink-slots', SinkSlots);
