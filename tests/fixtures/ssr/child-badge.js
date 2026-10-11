import { init, html } from '@verajs/core';

class ChildBadge extends HTMLElement {
  connectedCallback() {
    init({ host: this, shadow: 'open' }, () => {
      const label = this.getAttribute('label') ?? 'child';
      return () => html`<em>badge: ${label}</em>`;
    });
  }
}
customElements.define('child-badge', ChildBadge);
