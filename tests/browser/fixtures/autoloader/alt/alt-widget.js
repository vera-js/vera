customElements.define('alt-widget', class extends HTMLElement {
  connectedCallback() { this.textContent = 'alt'; }
});
