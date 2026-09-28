import { init, render, html } from '@verajs/core';

export default class FramesPlain extends HTMLElement {
  connectedCallback() {
    init(this, { mode: 'open' });
    render(() => html`<p>plain</p>`);
  }
}
customElements.define('frames-plain', FramesPlain);
