import { init, html, wire } from '@verajs/core';
import { initRouter, router } from '@verajs/router';

/**
 * An app shell whose router navigates on its own, wired the way an app wires it. Kept out of the
 * top-level fixtures because the whole-fixture sweeps would wire a router into every render after it.
 */
wire([router]);

export default class FirstView extends HTMLElement {
  connectedCallback() {
    init({ host: this, shadow: 'open' }, () => {
      initRouter(this, { view: 'main' }).addRoutes([
        { path: '/', component: () => html`<p>home</p>` },
        { path: '/about', component: () => html`<p>about</p>` },
      ]);
      return () => html`<nav>n</nav><main view="main"></main>`;
    });
  }
}
customElements.define('first-view', FirstView);
