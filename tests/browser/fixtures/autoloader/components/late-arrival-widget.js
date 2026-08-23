customElements.define('late-arrival-widget', class extends HTMLElement {
  connectedCallback() { this.textContent = 'late-arrival'; }
});
