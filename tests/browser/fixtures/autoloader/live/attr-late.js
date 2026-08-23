customElements.define('attr-late', class extends HTMLElement {
  connectedCallback() { this.textContent = 'attr-late'; }
});
