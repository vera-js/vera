/**
 * The page shell: the router, its outlet, the nav whose links it owns, and one of every other
 * component on the page.
 *
 * Routed links have to live in the router's own template — a link inside a child's shadow root is
 * invisible to the click listener, because the event is retargeted at the boundary. The `autoloader`
 * attribute is what makes `<sink-lazy>` discoverable; it is per-component opt-in by design.
 */
import { init, render, html, css, createStore } from '@verajs/core';
import { initRouter } from '@verajs/router';

import './sink-basics.js';
import './sink-bindings.js';
import './sink-list.js';
import './sink-collections.js';
import './sink-effects.js';
import './sink-styled.js';
import './sink-scoped.js';
import './sink-slots.js';
import './sink-form.js';

export default class SinkShell extends HTMLElement {
  /**
   * Enough to read by. Deliberately plain: this page is a test substrate, and a design would make
   * every parity diff harder to read for no benefit.
   */
  static styles = css`
    :host {
      display: block;
      font: 15px/1.5 system-ui, sans-serif;
      max-width: 52rem;
      margin: 2rem auto;
      padding: 0 1rem;
      color: #16181d;
    }
    h1 {
      font-size: 1.4rem;
      margin: 0 0 0.25rem;
    }
    h2 {
      font-size: 0.95rem;
      text-transform: uppercase;
      letter-spacing: 0.06em;
      color: #5a6070;
      margin: 0 0 0.5rem;
    }
    nav {
      display: flex;
      flex-wrap: wrap;
      gap: 0.75rem;
      padding: 0.75rem 0;
      border-bottom: 1px solid #d8dce4;
    }
    nav a {
      color: #2a5bd7;
    }
    nav a.active {
      font-weight: 700;
      text-decoration: none;
    }
    nav a.active-within {
      font-weight: 600;
    }
    main[view] {
      min-height: 3rem;
      margin: 1rem 0;
      padding: 0.75rem;
      background: #f4f6fa;
      border-radius: 6px;
    }
    .banner {
      padding: 0.5rem 0.75rem;
      background: #eef2fb;
      border-left: 3px solid #2a5bd7;
      border-radius: 3px;
      margin-bottom: 1rem;
    }
    .banner code {
      background: #dde5f7;
      padding: 0 0.25rem;
      border-radius: 3px;
    }
    ::slotted(*),
    sink-basics,
    sink-bindings,
    sink-list,
    sink-collections,
    sink-effects,
    sink-styled,
    sink-scoped,
    sink-form,
    sink-slots,
    sink-lazy {
      display: block;
      margin: 1.25rem 0;
      padding: 1rem;
      border: 1px solid #d8dce4;
      border-radius: 6px;
    }
  `;

  connectedCallback() {
    /**
     * The autoloader watches a **component**, and the opt-in is an attribute on the host — not on
     * something the component renders. An `autoloader` attribute on an inner `<div>` is invisible:
     * the `'render'` insert offers up this element, and `document.querySelectorAll('[autoloader]')`
     * cannot see into a shadow root. Set here so the server emits it too.
     */
    this.setAttribute('autoloader', '');
    init(this, { mode: 'open' });
    const state = createStore({ heading: 'Vera kitchen sink', mode: 'server-rendered' });
    this.state = state;
    /**
     * Which of the five modes this is. Written by each entry as its last act, so on the server —
     * where no entry runs — it stays at the value the markup was rendered with.
     */
    requestAnimationFrame(() => {
      state.mode = document.documentElement.dataset.sinkMode ?? 'server-rendered';
    });

    /**
     * `handleInitial: false` because the server has no navigation to perform and the client's
     * first route is driven by the test rather than by page load — the routes themselves are the
     * subject, not when they first fire.
     */
    const router = initRouter(this, { view: 'main', handleInitial: false });
    this.router = router;
    this.routeLog = [];

    router.addRoutes([
      { path: '/', name: 'home', title: 'Home', component: () => html`<p id="route">home</p>` },
      {
        path: '/user/:id',
        name: 'user',
        title: (params) => `User ${params.id}`,
        component: (params) => html`<p id="route">user ${params.id}</p>`,
      },
      { path: '/users/new', name: 'new-user', component: () => html`<p id="route">new user</p>` },
      { path: '/old', redirect: '/users/new' },
      {
        path: '/settings',
        name: 'settings',
        alias: '/preferences',
        component: () => html`<section id="route"><h3>settings</h3><div view="panel"></div></section>`,
        children: [
          { path: 'profile', name: 'profile', view: 'panel', component: () => html`<p id="panel">profile</p>` },
          {
            path: 'secret',
            name: 'secret',
            view: 'panel',
            beforeEnter: () => false,
            component: () => html`<p id="panel">never</p>`,
          },
        ],
      },
      { path: '/*rest', name: 'missing', title: '404', component: (params) => html`<p id="route">missing ${params.rest.join('/')}</p>` },
    ]);

    router.on('before-route', (to) => {
      this.routeLog.push(`before:${to.path}`);
    });
    router.on('after-route', (to) => {
      this.routeLog.push(`after:${to.path}`);
    });

    render(
      () => html`<div id="shell">
        <h1 id="heading">${state.heading}</h1>
        <!--
          Marked \`data-diagnostic\`: it reports the environment rather than the application, so the
          parity suites exclude it. Without that, the one element whose whole job is to differ
          between modes would fail every comparison of them.
        -->
        <p class="banner" data-diagnostic>
          Mode: <code id="mode">${state.mode}</code>. Every panel below has controls — click them and
          watch the numbers. The outlet under the nav is empty until you pick a route, because this
          router is started with <code>handleInitial: false</code> so the three rendering modes stay
          comparable.
        </p>
        <nav id="nav">
          <a route href="/">Home</a>
          <a route href="/user/7">User</a>
          <a route href="/users/new">New</a>
          <a route href="/settings">Settings</a>
          <a route href="/settings/profile">Profile</a>
          <a route href="/nope/deep">Missing</a>
        </nav>
        <main view="main"></main>

        <sink-basics></sink-basics>
        <sink-bindings></sink-bindings>
        <sink-list></sink-list>
        <sink-collections></sink-collections>
        <sink-effects></sink-effects>
        <sink-styled></sink-styled>
        <sink-scoped></sink-scoped>
        <sink-form label="Name" value="Ada"></sink-form>
        <sink-slots>
          <span slot="title">slotted title</span>
          <span>slotted body</span>
        </sink-slots>
        <sink-lazy></sink-lazy>
      </div>`
    );
  }
}

customElements.define('sink-shell', SinkShell);
