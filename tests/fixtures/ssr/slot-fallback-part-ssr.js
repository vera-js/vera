import { init, render, html } from '@verajs/core';
/** A filled slot whose FALLBACK holds a template value — committed fresh inside the slot's detached copy on hydration. */
export class SlotFallbackPartSsr extends HTMLElement {
  connectedCallback() {
    init(this);
    render(() => html`<s><slot name="s">fb:${html`<i>${'B'}</i>`}</slot></s>`);
  }
}
customElements.define('slot-fallback-part-ssr', SlotFallbackPartSsr);
