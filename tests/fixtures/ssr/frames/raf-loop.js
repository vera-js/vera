import { init, render, html } from '@verajs/core';

/** Schedules a frame from inside a frame, forever — an animation loop reachable on a server. */
export const runs = { count: 0 };
export default class RafLoop extends HTMLElement {
  connectedCallback() {
    init(this, { mode: 'open' });
    const tick = () => {
      runs.count++;
      requestAnimationFrame(tick);
    };
    requestAnimationFrame(tick);
    render(() => html`<p>looping</p>`);
  }
}
customElements.define('raf-loop', RafLoop);
