import { init, html } from '@verajs/core';
import './site-card.js';
export default class SitePage extends HTMLElement {
  connectedCallback() {
    init(this, () => () => html`<header><h1>${this.page.title}</h1><nav>${this.page.links.map((l) => html`<a href=${l.href}>${l.label}</a>`)}</nav></header><main>${this.page.cards.map((c) => html`<site-card .card=${c}></site-card>`)}</main><footer>© Example</footer>`);
  }
}
customElements.define('site-page', SitePage);
