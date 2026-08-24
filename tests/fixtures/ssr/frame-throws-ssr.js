import { init, render, html } from '@verajs/core';
export default class FrameThrowsSsr extends HTMLElement {
  connectedCallback() {
    init(this, { mode: 'open' });
    let ran = 0;
    requestAnimationFrame(() => {
      throw new Error('frame blew up');
    });
    requestAnimationFrame(() => {
      ran++;
    });
    render(() => html`<p>frames=${ran}</p>`);
  }
}
customElements.define('frame-throws-ssr', FrameThrowsSsr);
