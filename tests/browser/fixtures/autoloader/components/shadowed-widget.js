customElements.define('shadowed-widget', class extends HTMLElement {
  connectedCallback() { this.textContent = 'shadowed'; }
});
