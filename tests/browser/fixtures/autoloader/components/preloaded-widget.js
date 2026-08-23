customElements.define('preloaded-widget', class extends HTMLElement {
  connectedCallback() { this.textContent = 'preloaded'; }
});
