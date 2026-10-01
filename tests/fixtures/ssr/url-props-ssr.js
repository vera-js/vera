import { init, render, html } from '@verajs/core';

/** Shows what it was delivered: a router link's `to` and an `href`, each a URL the component would navigate to. */
class UrlLink extends HTMLElement {
  connectedCallback() {
    init(this, { mode: 'open' });
    render(() => html`<p>${String(this.to)} · ${String(this.href)}</p>`);
  }
}
customElements.define('url-link', UrlLink);

class UrlPage extends HTMLElement {
  connectedCallback() {
    init(this, { mode: 'open' });
    render(
      () => html`
        <url-link .to=${'javascript:alert(1)'} .href=${'javascript:alert(2)'}></url-link>
        <url-link .to=${'/inbox'} .href=${'/settings'}></url-link>
      `
    );
  }
}
customElements.define('url-page', UrlPage);
export default UrlPage;
