import { init, render, html } from '@verajs/core';
/** Every shadow-root option declarative shadow DOM can express, in one component. */
export default class ShadowOptionsSsr extends HTMLElement {
  connectedCallback() {
    init(this, { mode: 'open', delegatesFocus: true, clonable: true, serializable: true });
    render(() => html`<input id="inner" />`);
  }
}
customElements.define('shadow-options-ssr', ShadowOptionsSsr);
