/**
 * A link click has nobody to reject to.
 *
 * `navigate()` rejects when a guard or a component throws, which is right for a caller that awaits
 * it. A click is not that caller: the handler is `async`, so a rejection became an **unhandled
 * promise rejection** carrying the component's own message and nothing else — not the path, not
 * which router, not that this framework was involved. The page kept its previous view, correctly,
 * and said nothing about why the link had done nothing.
 *
 * Reported as a DOM event as well as a console line, for the reason `@verajs/autoloader` does the
 * same with `vera:autoload-error`: a route that fails to render is something an app may want to
 * render *around*, and an unhandled rejection cannot be caught where it matters.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { JSDOM } from 'jsdom';
import { load } from './dist.mjs';

const dom = new JSDOM('<!doctype html><html><body></body></html>', {
  url: 'https://x.test/',
  pretendToBeVisual: true,
});
for (const key of ['window', 'document', 'HTMLElement', 'customElements', 'Node', 'Element', 'CustomEvent', 'MouseEvent', 'requestAnimationFrame', 'cancelAnimationFrame'])
  globalThis[key] = dom.window[key];
globalThis.window = dom.window;
/** jsdom implements neither, and the router calls both on a successful navigation. */
dom.window.scrollTo = () => {};

const { initRouter, setRouterRenderer, navigate } = await load('router');
setRouterRenderer((template, view) => {
  view.innerHTML = typeof template === 'string' ? template : '';
});

const element = document.createElement('div');
const view = document.createElement('main');
view.setAttribute('view', 'main');
element.append(view);
const link = document.createElement('a');
link.setAttribute('route', '');
link.setAttribute('href', '/throws');
element.append(link);
document.body.append(element);

const router = initRouter(element, { view: 'main', focusView: false, handleInitial: false });
router.addRoutes([
  { path: '/ok', component: () => 'OK' },
  { path: '/throws', component: () => { throw new Error('component boom'); } },
]);

const settle = () => new Promise((resolve) => setTimeout(resolve, 40));

test('a link to a route that throws reports, and keeps the view it had', async () => {
  await navigate('/ok');
  assert.equal(view.innerHTML, 'OK');

  const events = [];
  element.addEventListener('vera:route-error', (event) => events.push(event.detail));
  const errors = [];
  const nativeError = console.error;
  console.error = (...args) => errors.push(String(args[0]));

  const rejections = [];
  const onRejection = (reason) => rejections.push(reason);
  process.on('unhandledRejection', onRejection);

  try {
    link.dispatchEvent(new dom.window.MouseEvent('click', { bubbles: true, button: 0 }));
    await settle();
  } finally {
    console.error = nativeError;
    process.off('unhandledRejection', onRejection);
  }

  assert.equal(rejections.length, 0, 'the click must not leave an unhandled rejection');
  assert.equal(view.innerHTML, 'OK', 'the previous view stands');
  assert.equal(events.length, 1, 'one vera:route-error');
  assert.equal(events[0].path, '/throws', 'and it names the path');
  assert.equal(events[0].error.message, 'component boom', 'and carries the original error');
  assert.ok(
    errors.some((message) => message.includes('[vera] router') && message.includes('/throws')),
    'the console line names the framework and the path'
  );
});

/** A caller that *does* await still gets the rejection — that path must not have been swallowed. */
test('navigate() still rejects for a programmatic caller', async () => {
  await assert.rejects(() => navigate('/throws'), /component boom/);
  await navigate('/ok');
  assert.equal(view.innerHTML, 'OK', 'and the router recovers');
});
