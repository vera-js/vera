/**
 * SSR fixture for the query pack: a filtered, paginated list rendered from the REQUEST URL.
 * The point is that a shared `?q=…&page=…` link arrives already filtered — the premise the pack
 * is built on, which it did not honour until the ssr declarations landed.
 */
import { init, render, html, wire } from '@verajs/core';
import { renderer } from '@verajs/renderer';
import { wireDirectives, directives, interaction, expressions, query, sensors } from '@verajs/directives';

if (!globalThis.__veraSsrShimmed) wire([renderer]);
wire([directives]);
wireDirectives([expressions, ...interaction, query, sensors]);

export default class QuerySsr extends HTMLElement {
  connectedCallback() {
    init(this, { mode: 'open' });
    render(
      () => html`
        <div data-vd-state="{ q: '', page: 1, counts: {}, seen: false }" data-vd-query="q page" data-vd-route>
          <ul data-vd-region="{ items: 'li', search: 'q', page: 'page', size: 2, counts: 'counts' }">
            <li>apple</li><li>banana</li><li>cherry</li><li>elderberry</li>
          </ul>
          <b data-vd-text="counts.matched"></b>
          <i data-vd-text="@route.path"></i>
          <em data-vd-in-view="seen" data-vd-class="{ revealed: seen }">reveal me</em>
        </div>
      `
    );
  }
}

customElements.define('query-ssr', QuerySsr);
