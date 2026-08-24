/** Fetched by the autoloader from inside a **declarative** shadow root — see autoload-declarative. */
customElements.define(
  'declarative-widget',
  class extends HTMLElement {
    connectedCallback() {
      this.attachShadow({ mode: 'open' }).textContent = 'loaded into a server-rendered root';
    }
  }
);
