customElements.define('static-widget', class extends HTMLElement {
  connectedCallback() { this.textContent = 'static'; }
});
