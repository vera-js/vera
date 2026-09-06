globalThis.__raceWidgetLoads = (globalThis.__raceWidgetLoads ?? 0) + 1;
customElements.define('race-widget', class extends HTMLElement {
  connectedCallback() { this.textContent = 'race-widget-live'; }
});
