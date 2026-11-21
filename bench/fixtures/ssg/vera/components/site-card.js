import { init, html } from '@verajs/core';
class SiteCard extends HTMLElement {
  connectedCallback() {
    init(this, () => () => html`<article class="card"><h2>${this.card.title}</h2><p>${this.card.text}</p><ul>${this.card.tags.map((t) => html`<li>${t}</li>`)}</ul></article>`);
  }
}
customElements.define('site-card', SiteCard);
