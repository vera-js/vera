/**
 * router({ animate: true }) against REAL view transitions. String assertions only.
 */
import { expect } from '@esm-bundle/chai';
import { router, initRouter, navigate, setRouterRenderer }
  from '../../packages/router/dist/development/vera-router.js';

const native = document.startViewTransition?.bind(document);
let transitions = 0;
if (native) {
  document.startViewTransition = (cb) => { transitions++; return native(cb); };
}

router({ animate: true });
setRouterRenderer((template, view) => { view.innerHTML = String(template); });

it('a navigation wraps its render in a REAL transition; the landing render never does', async function () {
  if (!native) this.skip();
  const el = document.createElement('div');
  const view = document.createElement('main');
  view.setAttribute('view', 'vtx');
  el.appendChild(view);
  document.body.appendChild(el);
  const { addRoutes } = initRouter(el, { view: 'vtx', handleInitial: false });
  addRoutes([
    { path: '/', component: () => 'home-view' },
    { path: '/away', component: () => 'away-view' },
  ]);
  await navigate('/', 'init');
  expect(transitions, 'init is establishment').to.equal(0);
  await navigate('/away');
  expect(transitions, 'the navigation animated, for real').to.equal(1);
  expect(view.textContent, 'and the route rendered').to.equal('away-view');
  el.remove();
});
