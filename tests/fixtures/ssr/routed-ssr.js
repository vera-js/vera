import { init, render, html } from '@verajs/core';
import { initRouter } from '@verajs/router';
/** The ordinary shape of an app shell: a router plus an outlet. */
export default class RoutedSsr extends HTMLElement {
  connectedCallback() {
    init(this, { mode: 'open' });
    const router = initRouter(this, { view: 'main', handleInitial: false });
    router.addRoutes([{ path: '/', component: () => html`<p>home</p>` }]);
    render(() => html`<nav><a route href="/">Home</a></nav><main view="main"></main>`);
  }
}
customElements.define('routed-ssr', RoutedSsr);
