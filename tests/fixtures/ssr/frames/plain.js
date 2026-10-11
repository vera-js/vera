import { init, html } from '@verajs/core';

export default class FramesPlain extends HTMLElement {
  connectedCallback() {
    init({ host: this, shadow: 'open' }, () => {
      return () => html`<p>plain</p>`;
    });
  }
}
customElements.define('frames-plain', FramesPlain);
