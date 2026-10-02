import { init, render, html } from '@verajs/core';

/** Records what attributeChangedCallback is told as it toggles its own observed attribute — see `ssr-node-insertion`. */
class ToggleProbe extends HTMLElement {
  static observedAttributes = ['hidden'];
  attributeChangedCallback(name, old, value) {
    (globalThis.__toggleSeen ??= []).push(`${old}->${value}`);
  }
  connectedCallback() {
    init(this, { mode: 'open' });
    render(() => html`<p>toggle</p>`);
    this.setAttribute('hidden', 'was');
    this.toggleAttribute('hidden');
    this.toggleAttribute('hidden');
  }
}
customElements.define('toggle-probe', ToggleProbe);
export default ToggleProbe;
