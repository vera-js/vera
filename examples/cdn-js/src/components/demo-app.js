import { init, createStore, render, useEffect } from '@verajs/core';
import { initRouter } from '@verajs/router';
import { html } from 'lit-html';

/**
 * Root of the buildless example.
 *
 * Plain JavaScript, plain custom element, no compile step. `<demo-counter>` is never imported
 * here — the autoloader fetches `components/demo-counter.js` the first time it appears in a
 * render, because this element carries the `autoloader` attribute in index.html.
 */
class DemoApp extends HTMLElement {
  connectedCallback() {
    init(this, { mode: 'open' });

    const state = createStore({ name: 'world', showCounter: false });

    useEffect(() => {
      console.log('name changed:', state.name);
    });

    useEffect(() => {
      const router = initRouter(this, { view: 'main' });

      router.addRoutes([
        { path: '/', title: 'Home', component: () => html`<p>Pick a route above.</p>` },
        {
          path: '/hello',
          title: 'Hello',
          component: () => html`<p>Hello, ${state.name}!</p>`,
        },
        {
          path: '/hello/:who',
          title: 'Hello someone',
          component: (params) => html`<p>Hello, ${params.who}!</p>`,
        },
        {
          path: '/*missing',
          title: 'Not found',
          component: (params) => html`<p>No route for <code>${params.missing}</code>.</p>`,
        },
      ]);
    });

    const onName = (e) => {
      state.name = e.target.value;
    };

    const toggleCounter = () => {
      state.showCounter = !state.showCounter;
    };

    render(() => {
      const { name, showCounter } = state;

      return html`
        <nav>
          <a route href="/">home</a>
          <a route href="/hello">hello</a>
          <a route href="/hello/verajs">hello/verajs</a>
          <a route href="/nowhere">404</a>
        </nav>

        <div view="main"></div>

        <p>
          <label>
            Name
            <input type="text" .value=${name} @input=${onName} />
          </label>
        </p>

        <p>
          <button @click=${toggleCounter}>
            ${showCounter ? 'Hide' : 'Show'} the lazily-loaded counter
          </button>
        </p>

        ${showCounter ? html`<demo-counter></demo-counter>` : ''}
      `;
    });
  }
}

customElements.define('demo-app', DemoApp);
