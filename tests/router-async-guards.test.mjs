/**
 * Route guards that await, and what happens when two navigations overlap.
 *
 * `services.ts` awaits the guard — `await link.beforeEnter?.(…)` — so an auth check that fetches is a
 * supported shape, and the most ordinary one a guard has. **No test in this repository used one**:
 * every `beforeEnter` in the suite returns synchronously, which is the only form that cannot overlap
 * with anything.
 *
 * ## What an await opens
 *
 * Click A, then B. A's guard is slow and B's is fast, so B arrives first and A resolves afterwards. If
 * nothing discards A, the user lands on the page they navigated away from — and the URL and the view
 * disagree about which one that is.
 *
 * `services.ts` stamps each navigation with an id for exactly this. The invariant is not "the first
 * one wins" or "the fastest one wins" but **the last one started wins**, whichever order they finish
 * in, so both directions are asserted: the newer navigation resolving second must still take
 * precedence, which is the case a naive "ignore anything that finishes late" guard gets wrong.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { JSDOM } from 'jsdom';
import { load } from './dist.mjs';

const dom = new JSDOM('<div></div>', { url: 'https://x.test/start' });
const { window } = dom;
for (const key of ['HTMLElement', 'CustomEvent', 'PopStateEvent', 'Event', 'MouseEvent', 'Node', 'Element'])
  globalThis[key] = window[key];
globalThis.window = window;
globalThis.document = window.document;
globalThis.requestAnimationFrame = (fn) => setTimeout(fn, 0);
window.scrollTo = () => {};

const { initRouter, navigate } = await load('router');

const settle = (ms = 60) => new Promise((resolve) => setTimeout(resolve, ms));
const delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

const element = window.document.createElement('div');
const view = window.document.createElement('main');
element.appendChild(view);
window.document.body.appendChild(element);
const router = initRouter(element, { view, focusView: false, handleInitial: false });

const rendered = [];
router.addRoutes([
  { path: '/start', component: () => (rendered.push('start'), '') },
  { path: '/slow', beforeEnter: async () => { await delay(30); return true; }, component: () => (rendered.push('slow'), '') },
  { path: '/fast', beforeEnter: async () => { await delay(2); return true; }, component: () => (rendered.push('fast'), '') },
  { path: '/refused', beforeEnter: async () => { await delay(5); return false; }, component: () => (rendered.push('refused'), '') },
  { path: '/boom', beforeEnter: async () => { await delay(2); throw new Error('guard exploded'); }, component: () => (rendered.push('boom'), '') },
]);

/** Back to a known place, with the log cleared, before each case. */
const from = async (path = '/start') => {
  await navigate(path);
  await settle();
  rendered.length = 0;
};

test('a guard that awaits and allows lets the navigation through', async () => {
  await from();
  assert.equal(await navigate('/fast'), true);
  await settle();
  assert.deepEqual(rendered, ['fast'], 'the route rendered');
  assert.equal(window.location.pathname, '/fast', 'and the URL followed');
});

test('a guard that awaits and refuses stops it, leaving the URL alone', async () => {
  await from();
  assert.equal(await navigate('/refused'), false);
  await settle();
  assert.deepEqual(rendered, [], 'nothing rendered, not even a catch-all');
  assert.equal(window.location.pathname, '/start', 'and the URL did not move');
});

test('a guard that throws rejects the navigation rather than half-applying it', async () => {
  await from();
  await assert.rejects(() => navigate('/boom'), /guard exploded/);
  await settle();
  assert.deepEqual(rendered, [], 'the route was not entered');
  assert.equal(window.location.pathname, '/start', 'and the URL did not move');
});

test('an overtaken navigation is discarded, not applied late', async () => {
  await from();
  const slow = navigate('/slow');
  await delay(5);
  const fast = navigate('/fast');
  await Promise.all([slow, fast]);
  await settle();

  assert.deepEqual(rendered, ['fast'], 'the abandoned route must not render after the one that replaced it');
  assert.equal(window.location.pathname, '/fast');
});

/**
 * The direction a naive staleness check gets wrong: discarding whatever finishes late would throw away
 * this one, which is the navigation the user actually asked for last.
 */
test('and the newer navigation still wins when it is the slower one', async () => {
  await from();
  const fast = navigate('/fast');
  await delay(1);
  const slow = navigate('/slow');
  await Promise.all([fast, slow]);
  await settle();

  assert.deepEqual(rendered, ['slow'], 'the last navigation started is the one that lands');
  assert.equal(window.location.pathname, '/slow');
});
