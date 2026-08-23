globalThis.__probeLoads = (globalThis.__probeLoads ?? 0) + 1;
customElements.define('probe-widget', class extends HTMLElement {
  connectedCallback() { this.textContent = 'probe'; }
});
