/**
 * A light component whose `<slot>` carries its own bindings — a DYNAMIC name, an event and a ref —
 * with a value AFTER it. The slot's parts used to be skipped entirely by adoption, which shifted
 * every value that followed and made hydration fail for any component shaped like this.
 */
import { init, render, html } from '@verajs/core';

export class SlotBoundSsr extends HTMLElement {
  connectedCallback() {
    init(this);
    render(
      () =>
        html`<header><slot name=${'header'} @slotchange=${() => {}}>no header</slot></header><footer>${'AFTER'}</footer>`
    );
  }
}

customElements.define('slot-bound-ssr', SlotBoundSsr);
