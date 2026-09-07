/**
 * SSR fixture: a real Vera component whose template carries DIRECTIVES. The app wires
 * `directives` exactly as a browser app would — the engine's `'init'` connector detects the
 * shim and evaluates once instead of activating, so nothing here is server-specific.
 */
import { init, render, html, wire } from '@verajs/core';
import { renderer } from '@verajs/renderer';
import { wireDirectives, directives, interaction, expressions } from '@verajs/directives';

/**
 * The RENDERER is guarded, because the server owns rendering — @verajs/ssr registers its own and
 * wiring the client one over it would serialize every component empty (its guard says exactly
 * this). DIRECTIVES is deliberately NOT guarded: the engine is runtime-aware, so one wiring is
 * correct in both places — it activates in a browser and evaluates once on a server.
 */
if (!globalThis.__veraSsrShimmed) wire([renderer]);
wire([directives]);
wireDirectives([expressions, ...interaction]);

export default class DirectivesSsr extends HTMLElement {
  connectedCallback() {
    init(this, { mode: 'open' });
    render(
      () => html`
        <div data-vd-state="{ open: false, name: 'vera', qty: 3, price: 40 }" data-vd-cloak>
          <nav data-vd-show="open" data-vd-class="{ is-open: open }">menu</nav>
          <p data-vd-show="!open">closed</p>
          <b data-vd-text="upper(name)"></b>
          <i data-vd-text="qty * price"></i>
          <span data-vd-class="{ bulk: qty * price > 100 }">total</span>
          <button data-vd-bind-aria-expanded="open" data-vd-bind-disabled="!open"
                  data-vd-on-click="{ open: !open }">toggle</button>
          <em data-vd-style="{ opacity: open ? 1 : 0.5 }">styled</em>
          <u data-vd-lazy-thing>a name no pack provides — for the preload list</u>
        </div>
      `
    );
  }
}

customElements.define('directives-ssr', DirectivesSsr);
