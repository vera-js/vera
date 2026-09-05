globalThis.__lazyLoads = (globalThis.__lazyLoads ?? 0) + 1;
customElements.define('lazy-widget', class extends HTMLElement {
  connectedCallback() { this.textContent = 'lazy-loaded'; }
});
