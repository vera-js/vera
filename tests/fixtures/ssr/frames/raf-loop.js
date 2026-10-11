import { init, html } from '@verajs/core';

/** Schedules a frame from inside a frame, forever — an animation loop reachable on a server. */
export const runs = { count: 0 };
export default class RafLoop extends HTMLElement {
  connectedCallback() {
    init({ host: this, shadow: 'open' }, () => {
      const tick = () => {
        runs.count++;
        requestAnimationFrame(tick);
      };
      requestAnimationFrame(tick);
      return () => html`<p>looping</p>`;
    });
  }
}
customElements.define('raf-loop', RafLoop);
