/**
 * **Every navigation gesture a component can want, and the two primitives that put them in reach.**
 *
 * The design question behind this file: how does a component go somewhere RELATIVE to where it is —
 * sibling, child, same-place-different-view — without knowing where it is mounted? Route-relative
 * resolution (React Router's answer) was considered and rejected: it is a second resolution grammar
 * whose rules — `..` by route, params spanning segments, current-route-as-directory — re-answer
 * questions the URL spec settled, and it exists to serve an architecture (components rendered by a
 * route tree) that this router does not have. Instead:
 *
 * - **Sibling is already free.** URL resolution replaces the last segment, so a bare
 *   `navigate('settings')` from `/users/5/profile` IS sibling navigation, mount-agnostic, identical
 *   to what `<a href="settings">` would do.
 * - **`resolve()`/`navigate({ name })` fill missing params from the current route**, so
 *   "same place, different view" and "child of here" are one call with no params threaded down.
 * - **`currentRoute()`** exposes `{ path, params }` page-wide, so anything not covered above is
 *   plain string work.
 * - The one URL rule that reads as a router bug — a relative word REPLACING a `:param` segment —
 *   gets a development warning naming both correct spellings, rather than a semantics change.
 *
 * The `<base>` element's effect on relative navigation is pinned here too, as behaviour rather than
 * accident: a `<base>` re-points EVERY relative URL on the page, `navigate()` included, which is
 * the platform's rule and the reason the docs lead with `setBasePath` (mounting with no change to
 * what relative paths mean).
 */
import assert from 'node:assert/strict';
import test from 'node:test';
import { JSDOM } from 'jsdom';
import { load, isProduction } from './dist.mjs';

const dom = new JSDOM('<!doctype html><html><head></head><body></body></html>', { url: 'http://localhost/' });
const { window } = dom;
for (const key of ['HTMLElement', 'CustomEvent', 'PopStateEvent', 'Event', 'MouseEvent']) globalThis[key] = window[key];
globalThis.window = window;
globalThis.document = window.document;
globalThis.requestAnimationFrame = (fn) => setTimeout(fn, 0);
window.scrollTo = () => {};
const tick = () => new Promise((resolve) => setTimeout(resolve, 25));

const { initRouter, navigate, resolve, currentRoute, setBasePath } = await load('router');
const doc = window.document;

let hit = null;
const host = doc.createElement('div');
const view = doc.createElement('main');
host.appendChild(view);
doc.body.appendChild(host);
const router = initRouter(host, { view, focusView: false, handleInitial: false });
router.addRoutes([
  { path: '/', component: () => { hit = 'home'; return ''; } },
  /** Root-level twin of the nested settings route — the <base> divergence test needs somewhere
   *  at the mount root to land, or "nothing matched" masquerades as "did not re-point". */
  { path: '/settings', component: () => { hit = 'root-settings'; return ''; } },
  { path: '/users/:id', name: 'user', component: () => { hit = 'user'; return ''; } },
  { path: '/users/:id/profile', name: 'user-profile', component: () => { hit = 'profile'; return ''; } },
  { path: '/users/:id/settings', name: 'user-settings', component: () => { hit = 'settings'; return ''; } },
  { path: '/users/:id/edit/:tab?', name: 'user-edit', component: () => { hit = 'edit'; return ''; } },
]);

/** The same-route no-op trap, avoided by construction: every test leaves from a known route. */
const from = async (path) => {
  await navigate('/', 'replace');
  await tick();
  if (path !== '/') {
    await navigate(path, 'navigate');
    await tick();
  }
  hit = null;
};
const go = async (target) => {
  hit = null;
  await navigate(target, 'navigate');
  await tick();
  return { hit, url: window.location.pathname };
};

test('SIBLING: a bare relative word, from a leaf, mount-agnostic', async () => {
  await from('/users/5/profile');
  assert.deepEqual(await go('settings'), { hit: 'settings', url: '/users/5/settings' },
    'the last segment is replaced, exactly as a relative href would');

  setBasePath('/app');
  await from('/users/5/profile');
  assert.deepEqual(await go('settings'), { hit: 'settings', url: '/app/users/5/settings' },
    'and setBasePath does not change what a relative path means');
  setBasePath(null);
});

/**
 * The platform's `<base>` rule, pinned as intended behaviour: a `<base>` element re-points every
 * relative URL on the page — a relative href AND a relative navigate, in lockstep. This is why the
 * docs lead with `setBasePath`, which mounts the app without touching relative meaning.
 */
test('a <base> ELEMENT re-points relative navigation to the mount root — the platform rule', async () => {
  doc.head.innerHTML = '<base href="/app/">';
  try {
    await from('/users/5/profile');
    const landed = await go('settings');
    assert.deepEqual(landed, { hit: 'root-settings', url: '/app/settings' },
      'under a <base>, "settings" means /app/settings everywhere on the page — links and navigate agree');
  } finally {
    doc.head.innerHTML = '';
    await from('/');
  }
});

test('currentRoute() answers page-wide, and hands out a copy', async () => {
  await from('/users/5/profile');
  const here = currentRoute();
  assert.equal(here.path, '/users/5/profile');
  assert.deepEqual(here.params, { id: '5' });

  here.params.id = 'corrupted';
  assert.deepEqual(currentRoute().params, { id: '5' }, 'mutating the answer must not poison later fills');
});

test('SAME PLACE, DIFFERENT VIEW: navigate({ name }) fills params from the current route', async () => {
  await from('/users/5/profile');
  assert.deepEqual(await go({ name: 'user-settings' }), { hit: 'settings', url: '/users/5/settings' },
    'no component had to know or thread the id — the page already knows it');
});

test('CHILD: the gesture URL semantics cannot spell relatively is one named call', async () => {
  await from('/users/5');
  assert.deepEqual(await go({ name: 'user-edit' }), { hit: 'edit', url: '/users/5/edit' },
    'child-of-here without route-relative grammar');
});

test('explicit params always beat the fill, and explicit undefined still omits an optional', async () => {
  await from('/users/5/profile');
  assert.equal(resolve('user-edit', { id: 9 }), '/users/9/edit', 'explicit id wins over the current 5');
  assert.equal(resolve('user-edit', { tab: undefined }), '/users/5/edit',
    "`key in params` — an explicit undefined means omit, not 'fill it for me'");
});

test('with nothing committed, resolve() behaves exactly as it always did', async () => {
  /** The SSR shape: a server pass has no committed navigation, so the fill finds nothing. */
  await from('/');
  assert.equal(resolve('user-edit', {}), '/users/:id/edit',
    'a missing required param stays visible in the output, as before the fill existed');
});

test('under a base, resolve() is filled AND href-ready in one string', async () => {
  setBasePath('/app');
  await from('/users/5/profile');
  assert.equal(resolve('user-settings'), '/app/users/5/settings',
    'the mounted path with the current id — straight into an href');
  setBasePath(null);
});

/**
 * The one URL rule that reads as a router defect, diagnosed instead of redefined: a relative word
 * from a path ENDING in a param replaces that param — `navigate('edit')` from `/users/5` goes to
 * `/users/edit`, the sibling, exactly as `<a href="edit">` would. Authors usually meant the child.
 * The semantics stay the platform's; the warning names both correct spellings, once per input.
 */
test('a relative word that swallows a :param is diagnosed; a static sibling is not', { skip: isProduction }, async () => {
  const said = [];
  const original = console.warn;
  console.warn = (...args) => said.push(args.join(' '));
  try {
    await from('/users/5');
    await go('edit');
    await from('/users/5/profile');
    await go('settings');
  } finally {
    console.warn = original;
  }
  const warnings = said.filter((line) => line.includes('replaces the last segment'));
  assert.equal(warnings.length, 1, `one warning for the swallow, none for the static sibling: ${JSON.stringify(said)}`);
  assert.match(warnings[0], /\[vera\]/);
  assert.match(warnings[0], /named route|absolute/, 'and it teaches both correct spellings');
});
