import { init, html } from '@verajs/core';
import { initRouter } from '@verajs/router';
/** The ordinary shape of an app shell: a router plus an outlet. */
export default class RoutedSsr extends HTMLElement {
  connectedCallback() {
    init({ host: this, shadow: 'open' }, () => {
      const router = initRouter(this, { view: 'main', handleInitial: false });
      router.addRoutes([{ path: '/', component: () => html`<p>home</p>` }]);
      return () => html`<nav><a route href="/">Home</a></nav><main view="main"></main>`;
    });
  }
}
customElements.define('routed-ssr', RoutedSsr);
