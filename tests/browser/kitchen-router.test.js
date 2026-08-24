/**
 * The router, driven in **both live modes** and compared after every navigation.
 *
 * A server renders a routed component's shell, not its route — the outlet is found by query and the
 * server holds markup as a string — so the outlet arrives empty and the client fills it. That makes
 * routing the first thing a hydrated page does that the server never did, and therefore the place a
 * wrong assumption about adopted DOM shows up.
 *
 * Every case exercises a documented semantic rather than "it navigates": specificity beating
 * declaration order, a guard cancelling, a redirect costing no history entry, an alias keeping its
 * own URL, a nested child rendering into an outlet its parent drew, `:param` decoding, the query
 * staying out of matching, and active-link marking.
 */
import { expect } from '@esm-bundle/chai';
import { canonical } from '../canonical.mjs';

const load = (path) =>
  new Promise((resolve) => {
    const frame = document.createElement('iframe');
    frame.style.cssText =
      'position:fixed;top:0;left:0;width:320px;height:240px;opacity:0.02;border:0;pointer-events:none;z-index:-1';
    frame.src = path;
    frame.addEventListener('load', () => resolve(frame));
    document.body.appendChild(frame);
  });

const until = async (predicate, what, timeout = 20000) => {
  const started = performance.now();
  for (;;) {
    let value;
    try {
      value = predicate();
    } catch {
      value = false;
    }
    if (value) return value;
    if (performance.now() - started > timeout) throw new Error(`timed out waiting for ${what}`);
    await new Promise((r) => setTimeout(r, 10));
  }
};

const settle = async (frame) => {
  for (let i = 0; i < 4; i++) await new Promise((r) => frame.contentWindow.requestAnimationFrame(() => r()));
  await Promise.resolve();
};

const modes = {};
const shellOf = (mode) => modes[mode].shell;
const outlet = (mode) => shellOf(mode).shadowRoot.querySelector('[view="main"]');

/** Navigate in both modes, settle both, and require the two DOMs to still agree. */
const goBoth = async (path) => {
  for (const mode of ['csr', 'hydrate']) {
    modes[mode].navigate(path);
    await settle(modes[mode].frame);
    await settle(modes[mode].frame);
  }
  expect(canonical(outlet('hydrate')), `the two modes rendered ${path} differently`).to.equal(
    canonical(outlet('csr'))
  );
};

before(async function loadBothLiveModes() {
  this.timeout(30000);
  for (const [mode, path] of [
    ['csr', '/tests/browser/fixtures/kitchen-csr.html'],
    ['hydrate', '/tests/browser/fixtures/kitchen-hydrate.html'],
  ]) {
    const frame = await load(path);
    await until(() => frame.contentDocument.documentElement.dataset.sinkMode === mode, `${mode} to boot`);
    const shell = await until(
      () =>
        frame.contentDocument.querySelector('sink-shell')?.shadowRoot?.querySelector('#shell') &&
        frame.contentDocument.querySelector('sink-shell'),
      `${mode} shell`
    );
    /** `navigate` is a module export, so it is reached through the frame's own module graph. */
    /** `navigate` and `resolve` are module exports, not router methods — reached through the frame. */
    const router = await frame.contentWindow.eval(
      "import('/packages/router/dist/development/vera-router.js')"
    );
    modes[mode] = { frame, shell, navigate: router.navigate, resolve: router.resolve };
    await settle(frame);
  }
});

describe('routing behaves identically in both live modes', () => {
  beforeEach(function raiseTheTimeout() {
    this.timeout(30000);
  });

  it('renders the root route into the outlet the server left empty', async () => {
    expect(canonical(outlet('hydrate')).trim(), 'the server should not have filled the outlet').to.equal('');
    await goBoth('/');
    expect(outlet('hydrate').querySelector('#route').textContent).to.equal('home');
  });

  it('a param arrives decoded', async () => {
    await goBoth('/user/John%20Doe');
    expect(outlet('hydrate').querySelector('#route').textContent).to.equal('user John Doe');
  });

  it('the most specific route wins, not the first registered', async () => {
    await goBoth('/users/new');
    expect(outlet('hydrate').querySelector('#route').textContent, '/users/new lost to /user/:id').to.equal(
      'new user'
    );
  });

  it('a wildcard catches what nothing else matches', async () => {
    await goBoth('/nope/deep');
    expect(outlet('hydrate').querySelector('#route').textContent).to.equal('missing nope/deep');
  });

  it('a redirect resolves before anything renders', async () => {
    await goBoth('/old');
    expect(outlet('hydrate').querySelector('#route').textContent).to.equal('new user');
    expect(modes.hydrate.frame.contentWindow.location.pathname, 'the redirect target owns the URL').to.equal(
      '/users/new'
    );
  });

  it('an alias reaches the route and keeps its own URL', async () => {
    await goBoth('/preferences');
    expect(outlet('hydrate').querySelector('#route h3').textContent).to.equal('settings');
    expect(modes.hydrate.frame.contentWindow.location.pathname).to.equal('/preferences');
  });

  it('a child renders into an outlet its parent drew', async () => {
    await goBoth('/settings/profile');
    const panel = outlet('hydrate').querySelector('[view="panel"] #panel');
    expect(panel, 'the nested outlet was not filled').to.exist;
    expect(panel.textContent).to.equal('profile');
  });

  it('a beforeEnter guard cancels the navigation', async () => {
    await goBoth('/settings/profile');
    await goBoth('/settings/secret');
    expect(
      outlet('hydrate').querySelector('[view="panel"] #panel').textContent,
      'the guard did not cancel'
    ).to.equal('profile');
  });

  it('a query string never reaches pattern matching', async () => {
    await goBoth('/users/new?page=2');
    expect(outlet('hydrate').querySelector('#route').textContent).to.equal('new user');
    expect(shellOf('hydrate').router.currentRoute.query.get('page')).to.equal('2');
  });

  it('a routed link marks itself active, and its ancestors active-within', async () => {
    await goBoth('/settings/profile');
    const links = (mode) =>
      [...shellOf(mode).shadowRoot.querySelectorAll('#nav a')].map(
        (a) => `${a.getAttribute('href')}:${a.className}:${a.getAttribute('aria-current') ?? ''}`
      );
    expect(links('hydrate')).to.deep.equal(links('csr'));
    const active = links('hydrate').find((entry) => entry.startsWith('/settings/profile'));
    expect(active, 'the exact link is not marked').to.contain('active');
    expect(active).to.contain('page');
    expect(
      links('hydrate').find((entry) => entry.startsWith('/settings:')),
      'the ancestor link is not marked'
    ).to.contain('active-within');
  });

  it('both events fire, in order, on every navigation', async () => {
    shellOf('hydrate').routeLog.length = 0;
    shellOf('csr').routeLog.length = 0;
    await goBoth('/user/9');
    expect(shellOf('hydrate').routeLog).to.deep.equal(shellOf('csr').routeLog);
    expect(shellOf('hydrate').routeLog).to.deep.equal(['before:/user/9', 'after:/user/9']);
  });

  it('a named route resolves to its URL', async () => {
    const url = modes.hydrate.resolve('user', { id: 'a b' });
    expect(url, 'params must be encoded').to.equal('/user/a%20b');
    await goBoth(url);
    expect(outlet('hydrate').querySelector('#route').textContent).to.equal('user a b');
  });
});
