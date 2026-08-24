/**
 * The page shell: the router, its outlet, the nav whose links it owns, and one of every other
 * component on the page.
 *
 * Routed links have to live in the router's own template — a link inside a child's shadow root is
 * invisible to the click listener, because the event is retargeted at the boundary. The `autoloader`
 * attribute is what makes `<sink-lazy>` discoverable; it is per-component opt-in by design.
 */
import { init, render, html, createStore } from '@verajs/core';
import { initRouter } from '@verajs/router';

import './sink-bindings.js';
import './sink-list.js';
import './sink-collections.js';
import './sink-effects.js';
import './sink-styled.js';
import './sink-scoped.js';
import './sink-slots.js';
import './sink-form.js';

export default class SinkShell extends HTMLElement {
  connectedCallback() {
    /**
     * The autoloader watches a **component**, and the opt-in is an attribute on the host — not on
     * something the component renders. An `autoloader` attribute on an inner `<div>` is invisible:
     * the `'render'` insert offers up this element, and `document.querySelectorAll('[autoloader]')`
     * cannot see into a shadow root. Set here so the server emits it too.
     */
    this.setAttribute('autoloader', '');
    init(this, { mode: 'open' });
    const state = createStore({ heading: 'Vera kitchen sink' });
    this.state = state;

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
        <nav id="nav">
          <a route href="/">Home</a>
          <a route href="/user/7">User</a>
          <a route href="/users/new">New</a>
          <a route href="/settings">Settings</a>
          <a route href="/settings/profile">Profile</a>
          <a route href="/nope/deep">Missing</a>
        </nav>
        <main view="main"></main>

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
