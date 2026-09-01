/**
 * **Pass 1 probes, part two.** The module surfaces the kitchen sink wires but nothing asserted:
 * the autoloader's error path and its two helpers, the router's history and teardown APIs, and the
 * swappable render scheduler.
 *
 * Each is a documented API. `docs/CODE-PRINCIPLES.md` #6 makes the module system the product, so a
 * documented entry point nothing exercises is the same risk as untested code — and this repo has
 * shipped a module that registered into a map nobody read.
 */
import { expect } from '@esm-bundle/chai';

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

let frame;
let shell;
let view;
let router;
let core;

before(async function bootOneLiveMode() {
  this.timeout(30000);
  frame = await load('/tests/browser/fixtures/kitchen-csr.html');
  await until(() => frame.contentDocument.documentElement.dataset.sinkMode === 'csr', 'the app to boot');
  shell = await until(
    () =>
      frame.contentDocument.querySelector('sink-shell')?.shadowRoot?.querySelector('#shell') &&
      frame.contentDocument.querySelector('sink-shell'),
    'the shell'
  );
  view = frame.contentWindow;
  router = await view.eval("import('/packages/router/dist/development/vera-router.js')");
  core = await view.eval("import('/packages/core/dist/development/vera.js')");
  await settle(frame);
});

describe('the autoloader', () => {
  beforeEach(function raiseTheTimeout() {
    this.timeout(30000);
  });

  it('reports a failed load as a DOM event, so an app can render around it', async () => {
    const { autoloader } = await view.eval(
      "import('/packages/autoloader/dist/development/vera-autoloader.js')"
    );
    const autoload = autoloader(new URL('/examples/kitchen-sink/entry-client.js', view.location.href).href, 'lazy');

    const host = frame.contentDocument.createElement('div');
    host.setAttribute('autoloader', '');
    frame.contentDocument.body.appendChild(host);
    const failures = [];
    host.addEventListener('vera:autoload-error', (event) => failures.push(event.detail));

    host.innerHTML = '<never-shipped-widget></never-shipped-widget>';
    autoload(host);
    const detail = await until(() => failures[0], 'the failure event');

    expect(detail.tag).to.equal('never-shipped-widget');
    expect(detail.src, 'the event must name the URL it tried').to.contain('/lazy/never-shipped-widget.js');
    expect(detail.element, 'and the element, which is what retry() takes').to.equal(
      host.querySelector('never-shipped-widget')
    );
  });

  it('url() answers what it would fetch, without fetching it', async () => {
    const { autoloader } = await view.eval(
      "import('/packages/autoloader/dist/development/vera-autoloader.js')"
    );
    const autoload = autoloader(new URL('/examples/kitchen-sink/entry-client.js', view.location.href).href, 'lazy');
    expect(autoload.url('sink-lazy')).to.contain('/examples/kitchen-sink/lazy/sink-lazy.js');
  });

  it('autoload-ignore excludes that element only', async () => {
    const { autoloader } = await view.eval(
      "import('/packages/autoloader/dist/development/vera-autoloader.js')"
    );
    const autoload = autoloader(new URL('/examples/kitchen-sink/entry-client.js', view.location.href).href, 'lazy');
    const host = frame.contentDocument.createElement('div');
    host.setAttribute('autoloader', '');
    frame.contentDocument.body.appendChild(host);
    const failures = [];
    host.addEventListener('vera:autoload-error', (event) => failures.push(event.detail.tag));

    host.innerHTML =
      '<ignored-widget autoload-ignore></ignored-widget><wanted-widget></wanted-widget>';
    autoload(host);
    await until(() => failures.includes('wanted-widget'), 'the un-ignored element to be tried');
    /** Given the ignored one was in the same batch, it has had every chance to be attempted. */
    expect(failures, 'an ignored element was fetched anyway').to.not.contain('ignored-widget');
  });
});

describe('the router beyond navigation', () => {
  beforeEach(function raiseTheTimeout() {
    this.timeout(30000);
  });

  const outlet = () => shell.shadowRoot.querySelector('[view="main"]');

  it('back and forward restore the entries around them', async () => {
    await router.navigate('/user/1');
    await settle(frame);
    await router.navigate('/user/2');
    await settle(frame);
    expect(outlet().textContent).to.contain('user 2');

    router.back();
    await until(() => outlet().textContent.includes('user 1'), 'back to /user/1');
    router.forward();
    await until(() => outlet().textContent.includes('user 2'), 'forward to /user/2');
  });

  it('a hash-only change does not re-route but does reach currentRoute', async () => {
    await router.navigate('/user/3');
    await settle(frame);
    shell.routeLog.length = 0;
    await router.navigate('/user/3#section');
    await settle(frame);
    expect(shell.router.currentRoute.hash, 'the fragment must reach the snapshot').to.equal('#section');
    expect(
      shell.routeLog.filter((entry) => entry.startsWith('before:')),
      'a hash-only change re-routed'
    ).to.deep.equal([]);
  });

  it('meta rides along on every snapshot', async () => {
    shell.router.addRoutes([{ path: '/with-meta', name: 'meta', meta: { layout: 'wide' }, component: () => '' }]);
    await router.navigate('/with-meta');
    await settle(frame);
    expect(shell.router.currentRoute.meta).to.deep.equal({ layout: 'wide' });
  });

  it('removeRoute takes a named route back out', async () => {
    /** A template, not a string: a plain string renders as TEXT, never parsed as HTML. */
    shell.router.addRoutes([
      { path: '/temporary', name: 'temporary', component: () => core.html`<p id="temp">here</p>` },
    ]);
    await router.navigate('/temporary');
    await settle(frame);
    expect(outlet().querySelector('#temp'), 'the route did not render').to.exist;

    shell.router.removeRoute('temporary');
    await router.navigate('/user/4');
    await settle(frame);
    await router.navigate('/temporary');
    await settle(frame);
    expect(outlet().querySelector('#temp'), 'a removed route still rendered').to.equal(null);
  });
});

describe('the router as an event system', () => {
  beforeEach(function raiseTheTimeout() {
    this.timeout(30000);
  });

  const outlet = () => shell.shadowRoot.querySelector('[view="main"]');

  it('dispatches its three events as DOM events, bubbling and composed', async () => {
    const seen = [];
    const listener = (event) => seen.push({ type: event.type, path: event.detail?.currentRoute?.path });
    for (const type of ['vera:before-leave', 'vera:before-route', 'vera:after-route'])
      frame.contentDocument.addEventListener(type, listener);

    await router.navigate('/user/11');
    await settle(frame);
    for (const type of ['vera:before-leave', 'vera:before-route', 'vera:after-route'])
      frame.contentDocument.removeEventListener(type, listener);

    expect(
      seen.map((entry) => entry.type),
      'all three events must reach the document, in order'
    ).to.deep.equal(['vera:before-leave', 'vera:before-route', 'vera:after-route']);
    /** Composed as well as bubbling, or nothing outside the shadow root would have heard them. */
    expect(seen.at(-1).path, 'the snapshot must ride along on detail').to.equal('/user/11');
  });

  it('preventDefault on a before- event cancels the navigation', async () => {
    await router.navigate('/user/12');
    await settle(frame);
    const stop = (event) => event.preventDefault();
    frame.contentDocument.addEventListener('vera:before-route', stop);
    await router.navigate('/user/13');
    await settle(frame);
    frame.contentDocument.removeEventListener('vera:before-route', stop);
    expect(outlet().textContent, 'preventDefault did not cancel').to.contain('user 12');
  });

  it('a handler returning false cancels, and a throwing one fails closed', async () => {
    await router.navigate('/user/14');
    await settle(frame);

    const refuse = () => false;
    shell.router.on('before-route', refuse);
    await router.navigate('/user/15');
    await settle(frame);
    expect(outlet().textContent, 'returning false did not cancel').to.contain('user 14');
    shell.router.off?.('before-route', refuse);

    const explode = () => {
      throw new Error('kitchen sink: a guard that throws');
    };
    shell.router.on('before-route', explode);
    await router.navigate('/user/16');
    await settle(frame);
    expect(outlet().textContent, 'a throwing guard must fail closed').to.contain('user 14');
    shell.router.off?.('before-route', explode);
  });
});

describe('the render scheduler is swappable', () => {
  beforeEach(function raiseTheTimeout() {
    this.timeout(30000);
  });

  it('microtask scheduling lands before the next frame', async () => {
    const effects = shell.shadowRoot.querySelector('sink-effects');
    core.setRenderScheduler(core.microtask);
    try {
      effects.bump(1);
      /** No frame awaited — a microtask scheduler must have committed by the time this resolves. */
      await Promise.resolve();
      await Promise.resolve();
      await Promise.resolve();
      expect(
        effects.shadowRoot.querySelector('#n').textContent,
        'a microtask-scheduled render had not committed'
      ).to.equal(String(effects.state.n));
    } finally {
      core.setRenderScheduler((run) => view.requestAnimationFrame(() => run()));
    }
  });
});
