globalThis.__routeWidgetLoads = (globalThis.__routeWidgetLoads ?? 0) + 1;
customElements.define('route-widget', class extends HTMLElement {
  connectedCallback() { this.textContent = 'route-widget-live'; }
});
