import { init, html } from '@verajs/core';

/** Appends a style and a script to the document head — see `tests/ssr-shim-walker-define.test.mjs`. */
class HeadAppendPage extends HTMLElement {
  connectedCallback() {
    init(this, () => {
      const style = document.createElement('style');
      style.textContent = '.from-head { color: red }';
      document.head.appendChild(style);
      const script = document.createElement('script');
      script.textContent = 'alert(1)';
      document.head.appendChild(script);
      return () => html`<p>head</p>`;
    });
  }
}
customElements.define('head-append-page', HeadAppendPage);
export default HeadAppendPage;
