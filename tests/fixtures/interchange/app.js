/**
 * **ONE shared app module, imported unchanged by the server and the browser** (Brian, 2026-10-10: "component and build
 * code should work identically on the server and client, they should be interchangeable"). It wires every client module
 * an app would and defines real components — with NO `__veraSsrShimmed` guard anywhere. tests/interchange-server-client
 * renders it through @verajs/ssr in one process and hydrates the output in another; a module that needs a guard here is
 * a defect.
 */
import { wire, init, html, createStore, useEffect } from '@verajs/core';
import { renderer } from '@verajs/renderer';
import { hydration } from '@verajs/renderer/hydration';
import { slots } from '@verajs/renderer/slots';
import { hydrateSlots } from '@verajs/renderer/hydrate-slots';
import { styles, css } from '@verajs/styles';

wire([renderer, hydration, slots, hydrateSlots, styles]);

/** A one-form component: state, an effect, an event. */
customElements.define('ia-counter', class extends HTMLElement {
  connectedCallback() {
    init(this, (host) => {
      const state = createStore({ n: 1 });
      /** Counts its runs on the element: the server's markup carries the server run, the client adds its own. */
      useEffect(() => { host.dataset.effects = String(Number(host.dataset.effects ?? 0) + 1); });
      return () => html`<p>count ${state.n}</p><button @click=${() => state.n++}>more</button>`;
    });
  }
});

/** A light-DOM slot host: named and unnamed content. */
customElements.define('ia-card', class extends HTMLElement {
  connectedCallback() {
    init(this, () => () => html`<article><header><slot name="header">no header</slot></header><main><slot>no body</slot></main></article>`);
  }
});

/** A component with `static styles` (light DOM: hoisted, scoped). */
customElements.define('ia-styled', class extends HTMLElement {
  static styles = css`p { color: rebeccapurple; }`;
  connectedCallback() {
    init(this, () => () => html`<p>styled</p>`);
  }
});

/** The root: every kind above, nested. */
customElements.define('ia-app', class extends HTMLElement {
  connectedCallback() {
    init(this, () => () => html`<ia-counter></ia-counter><ia-card><h2 slot="header">Title</h2>body</ia-card><ia-styled></ia-styled>`);
  }
});
