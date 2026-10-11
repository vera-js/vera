import { init, html } from '@verajs/core';
/** Every shadow-root option declarative shadow DOM can express, in one component. */
export default class ShadowOptionsSsr extends HTMLElement {
  connectedCallback() {
    init({ host: this, shadow: { mode: 'open', delegatesFocus: true, clonable: true, serializable: true } }, () => {
      return () => html`<input id="inner" />`;
    });
  }
}
customElements.define('shadow-options-ssr', ShadowOptionsSsr);
