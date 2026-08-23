customElements.define('ignored-then-not', class extends HTMLElement {
  connectedCallback() { this.textContent = 'ignored-then-not'; }
});
