/**
 * **Pass 15 probes.** What survives a failure, and what happens with more than one router.
 *
 * Core deliberately does not rethrow a hook error — one bad effect must not take out the hooks
 * beside it — so the question is whether the *rest of the page* keeps working after one component
 * fails, which is the only thing that isolation is for.
 *
 * And the router documents that all routers on a page share the URL and follow every navigation,
 * with history getting one entry per user navigation rather than one per router. Two routers is
 * the configuration where that is either true or quietly wrong.
 */
import { expect } from '@esm-bundle/chai';
import { setRenderer, init, render, html, createStore, wire } from '../../packages/core/dist/development/vera.js';
import { render as domRender } from '../../packages/renderer/dist/development/vera-renderer.js';
import { initRouter, navigate, connectRouter } from '../../packages/router/dist/development/vera-router.js';

setRenderer(domRender);
void connectRouter;
const frame = () => new Promise((r) => requestAnimationFrame(() => setTimeout(r, 0)));

/** Errors are collected rather than logged, so a deliberate failure does not look like a real one. */
const caught = [];
/**
 * The router imports no registry, so it has to be handed core's. It used to share it by accident —
 * under the development condition both resolve to one `@verajs/inserts`.
 */
wire([connectRouter]);
wire({ on: 'error', fn: (error) => caught.push(String(error?.message ?? error)), priority: 20 });

describe('a failing component does not take the page with it', () => {
  it('the page keeps rendering after one component throws in render', async () => {
    customElements.define(
      'resilience-bad',
      class extends HTMLElement {
        connectedCallback() {
          init(this, { mode: 'open' });
          const state = createStore({ explode: false });
          this.state = state;
          render(() => {
            if (state.explode) throw new Error('resilience: deliberate render failure');
            return html`<p id="bad">alive</p>`;
          });
        }
      }
    );
    customElements.define(
      'resilience-good',
      class extends HTMLElement {
        connectedCallback() {
          init(this, { mode: 'open' });
          const state = createStore({ n: 0 });
          this.state = state;
          render(() => html`<p id="good">${state.n}</p>`);
        }
      }
    );

    const bad = document.createElement('resilience-bad');
    const good = document.createElement('resilience-good');
    document.body.append(bad, good);
    await frame();

    const before = caught.length;
    bad.state.explode = true;
    await frame();
    expect(caught.length, 'the error insert never saw it').to.be.greaterThan(before);

    /** The neighbour must still be live. */
    good.state.n = 7;
    await frame();
    expect(good.shadowRoot.querySelector('#good').textContent, 'a sibling stopped rendering').to.equal('7');

    /** And the failing one recovers when its state stops failing. */
    bad.state.explode = false;
    await frame();
    expect(bad.shadowRoot.querySelector('#bad')?.textContent, 'the failing component never recovered').to.equal(
      'alive'
    );
  });

  /**
   * Deliberately **not** tested here: a component whose `connectedCallback` throws outright. A
   * custom-element reaction is the platform's to run, and Chromium both rethrows it to whoever
   * called `appendChild` and reports it globally — so a test of it is a test of the browser, with
   * two error paths to absorb and nothing of this framework's in between. What is Vera's, and is
   * covered above, is a failure *inside a hook*: that one core isolates on purpose.
   */
});

describe('two routers on one page', () => {
  it('both follow every navigation, and history gets one entry', async () => {
    const makeRouter = (view) => {
      const element = document.createElement('div');
      const outlet = document.createElement('main');
      outlet.setAttribute('view', view);
      element.appendChild(outlet);
      document.body.appendChild(element);
      const router = initRouter(element, { view, focusView: false, handleInitial: false });
      router.addRoutes([
        { path: '/two/a', component: () => html`<p class="where">${view}:a</p>` },
        { path: '/two/b', component: () => html`<p class="where">${view}:b</p>` },
      ]);
      return { router, outlet };
    };

    const left = makeRouter('left');
    const right = makeRouter('right');

    const lengthBefore = history.length;
    await navigate('/two/a');
    await frame();
    await frame();

    expect(left.outlet.textContent, 'the first router did not route').to.equal('left:a');
    expect(right.outlet.textContent, 'the second router did not follow').to.equal('right:a');
    expect(
      history.length - lengthBefore,
      'one user navigation must cost one history entry, whatever the router count'
    ).to.equal(1);

    await navigate('/two/b');
    await frame();
    await frame();
    expect(left.outlet.textContent).to.equal('left:b');
    expect(right.outlet.textContent).to.equal('right:b');

    left.router.deleteRouter();
    right.router.deleteRouter();
  });
});
