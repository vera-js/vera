/**
 * **The buildless path, on the production bundles.**
 *
 * `docs/CODE-PRINCIPLES.md` #9 makes this a hard constraint rather than an aspiration: paste it into
 * CodePen and it runs, with no toolchain. Everything else in this suite loads
 * `dist/development/*.js` through a bundler-shaped resolver, so the **minified** output — where
 * properties are mangled, `__DEV__` is folded to `false` and its branches deleted, and every bundle
 * inlines its own copy of `@verajs/inserts` — is exercised nowhere else in a browser.
 *
 * That last one is the trap `connectInserts` exists for, and it only exists in this mode: loading
 * `vera.min.js` and `vera-router.min.js` yields two separate registries, so a module registering
 * through its own copy writes to a map core never reads. It works in development and silently does
 * nothing here, which is the worst way for it to fail.
 *
 * The page is a **single file**, deliberately. A test runner that rewrites bare specifiers would
 * resolve a separate component module to the development bundles and quietly test a mix of the two
 * builds — which is exactly what the first version of this suite did. An inline module is served as
 * written, so the import map is what resolves it, which is the thing under test.
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
let app;

before(async function bootTheBuildlessPage() {
  this.timeout(30000);
  frame = await load('/tests/browser/fixtures/kitchen-buildless.html');
  await until(() => frame.contentDocument.documentElement.dataset.sinkMode === 'buildless', 'it to boot');
  app = await until(
    () =>
      frame.contentDocument.querySelector('buildless-app')?.shadowRoot?.querySelector('#app') &&
      frame.contentDocument.querySelector('buildless-app'),
    'the app'
  );
  await settle(frame);
});

const inside = (selector) => app.shadowRoot.querySelector(selector);

describe('the minified bundles, with no build step', () => {
  beforeEach(function raiseTheTimeout() {
    this.timeout(30000);
  });

  it('renders, with every binding kind the import map resolved', () => {
    expect(inside('#n').textContent).to.equal('0');
    expect([...app.shadowRoot.querySelectorAll('#rows li')].map((li) => li.dataset.id)).to.deep.equal([
      'a',
      'b',
      'c',
    ]);
    /** `@verajs/renderer/spread` is its own bundle, and its protocol crosses the boundary. */
    expect(inside('#spread').getAttribute('title')).to.equal('spread title');
    expect(inside('#spread').hasAttribute('hidden'), 'a false boolean must not reach markup').to.equal(false);
  });

  it('styles a component through a constructed sheet', () => {
    expect(app.shadowRoot.adoptedStyleSheets.length, '`static styles` did not adopt').to.equal(1);
    expect(getComputedStyle(inside('.badge')).color).to.equal('rgb(0, 128, 128)');
  });

  it('routes, which is the whole reason connectInserts exists', async () => {
    /**
     * Driven through the page's **own** `navigate`, which the app exposes. Importing the router a
     * second time from the test gave a different module instance — one whose registry had never
     * been connected and whose routers were never registered — so it navigated nothing and looked
     * exactly like a `connectInserts` failure. Worth knowing before writing the next one of these.
     */
    await app.navigate('/user/42');
    await settle(frame);
    expect(
      inside('[view="main"]').textContent,
      'the router rendered nothing — its registry is not core’s'
    ).to.contain('user 42');
  });

  it('still reacts after minification, where properties are mangled', async () => {
    app.bump();
    await settle(frame);
    expect(inside('#n').textContent).to.equal('1');
  });

  it('autoloads through the minified module too', async () => {
    const lazy = await until(
      () => inside('sink-lazy')?.shadowRoot?.querySelector('#lazy'),
      '<sink-lazy> to autoload'
    );
    expect(lazy.textContent).to.equal('loaded on demand');
  });
});
