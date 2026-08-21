import { init, render, html } from '@verajs/core';

class ChildBadge extends HTMLElement {
  connectedCallback() {
    init(this, { mode: 'open' });
    const label = this.getAttribute('label') ?? 'child';
    render(() => html`<em>badge: ${label}</em>`);
  }
}
customElements.define('child-badge', ChildBadge);
