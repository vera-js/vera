import { expect } from '@esm-bundle/chai';
import { initRouter, setRenderer } from '../../packages/router/dist/development/vera-router.js';

/**
 * `focusView` — focus moves into the newly routed view on user navigation.
 *
 * `tests/router-guards.test.mjs` covers the same behaviour under jsdom, and does so correctly —
 * an earlier version of this comment claimed jsdom could not run it, which was wrong. The failure
 * was a missing `route` attribute on the test's links, not an environment limit.
 *
 * This suite is still worth its keep: jsdom emulates focus with a simple activeElement pointer,
 * while a browser applies the real focusability rules — a `tabIndex` that actually makes an element
 * focusable, a disabled control that refuses focus. Same assertions, real engine.
 */

setRenderer((template, container) => {
  container.innerHTML = typeof template === 'string' ? template : '';
});

const settle = () => new Promise((r) => setTimeout(r, 40));

const makeApp = (routes, options = {}) => {
  const el = document.createElement('div');
  const view = document.createElement('main');
  el.appendChild(view);
  document.body.appendChild(el);
  const r = initRouter(el, { view, handleInitial: false, ...options });
  r.addRoutes(routes);
  return { el, view, r };
};

const clickTo = async (app, href) => {
  const link = document.createElement('a');
  link.href = href;
  link.textContent = href;
  /** Opt-in marker: the click handler ignores any link without it, so the browser keeps its
      default behaviour for ordinary links. Without this the page really navigates. */
  link.setAttribute('route', '');
  app.el.appendChild(link);
  link.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }));
  await settle();
};

const startPath = location.pathname;
afterEach(() => history.replaceState(null, '', startPath));

it('a link click routes and moves focus to the first focusable element', async () => {
  const app = makeApp(
    [{ path: '/rf-input', component: () => '<section><input id="target"><button>b</button></section>' }],
    { focusView: true }
  );
  await clickTo(app, '/rf-input');

  expect(app.view.querySelector('#target'), 'the route rendered').to.not.equal(null);
  expect(document.activeElement.id, 'focus moved into the view').to.equal('target');
  app.el.remove();
});

it('with nothing focusable, the view root itself takes focus', async () => {
  const app = makeApp(
    [{ path: '/rf-plain', component: () => '<section id="plain">nothing focusable here</section>' }],
    { focusView: true }
  );
  await clickTo(app, '/rf-plain');

  const focused = document.activeElement;
  expect(focused.id, 'the section took focus').to.equal('plain');
  /** `-1` takes focus from script without adding a permanent tab stop; `0` would add one. */
  expect(focused.tabIndex, 'made focusable without joining the tab order').to.equal(-1);
  app.el.remove();
});

it('focusView: false leaves focus where the user put it', async () => {
  const outside = document.createElement('input');
  document.body.appendChild(outside);
  const app = makeApp(
    [{ path: '/rf-off', component: () => '<section><input id="untouched"></section>' }],
    { focusView: false }
  );
  outside.focus();
  await clickTo(app, '/rf-off');

  expect(app.view.querySelector('#untouched'), 'it still routed').to.not.equal(null);
  expect(document.activeElement === outside, 'focus was not stolen').to.be.true;
  app.el.remove();
  outside.remove();
});
