customElements.define('ssr-child', class extends HTMLElement {
  connectedCallback() { this.textContent = 'hydrated child'; }
});
