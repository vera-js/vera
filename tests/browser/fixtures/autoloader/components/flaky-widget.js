customElements.define('flaky-widget', class extends HTMLElement {
  connectedCallback() { this.textContent = 'flaky'; }
});
