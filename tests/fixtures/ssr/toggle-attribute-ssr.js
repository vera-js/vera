import { init, html } from '@verajs/core';

/** Records what attributeChangedCallback is told as it toggles its own observed attribute — see `ssr-node-insertion`. */
class ToggleProbe extends HTMLElement {
  static observedAttributes = ['hidden'];
  attributeChangedCallback(name, old, value) {
    (globalThis.__toggleSeen ??= []).push(`${old}->${value}`);
  }
  connectedCallback() {
    init({ host: this, shadow: 'open' }, () => {
      return () => html`<p>toggle</p>`;
    });
    this.setAttribute('hidden', 'was');
    this.toggleAttribute('hidden');
    this.toggleAttribute('hidden');
  }
}
customElements.define('toggle-probe', ToggleProbe);
export default ToggleProbe;
