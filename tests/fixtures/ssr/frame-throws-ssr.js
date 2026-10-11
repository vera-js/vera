import { init, html } from '@verajs/core';
export default class FrameThrowsSsr extends HTMLElement {
  connectedCallback() {
    init({ host: this, shadow: 'open' }, () => {
      let ran = 0;
      requestAnimationFrame(() => {
        throw new Error('frame blew up');
      });
      requestAnimationFrame(() => {
        ran++;
      });
      return () => html`<p>frames=${ran}</p>`;
    });
  }
}
customElements.define('frame-throws-ssr', FrameThrowsSsr);
