/**
 * **Buildless JSX**, transformed in the browser, on the production bundles.
 *
 * `docs/CODE-PRINCIPLES.md` #9 rules JSX out of the *framework* — it cannot run without a compile
 * step, so templates are tagged template literals. `@verajs/jsx/standalone` is the escape hatch for
 * a playground: it finds every `script[type="text/vera-jsx"]`, runs the same zero-dependency
 * transform the Vite plugin uses, and imports the result as a module blob.
 *
 * `tests/kitchen-jsx.test.mjs` compares the transform's *output* against hand-written templates in
 * Node. This is the other half: the transform running where it claims to, with no toolchain, and
 * the emitted templates hitting the real renderer through an import map.
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

before(async function bootTheJsxPage() {
  this.timeout(30000);
  frame = await load('/tests/browser/fixtures/kitchen-jsx-buildless.html');
  await until(
    () => frame.contentDocument.documentElement.dataset.sinkMode === 'jsx-buildless',
    'the JSX block to compile and run'
  );
  app = await until(
    () =>
      frame.contentDocument.querySelector('jsx-app')?.shadowRoot?.querySelector('#app') &&
      frame.contentDocument.querySelector('jsx-app'),
    'the app'
  );
  await settle(frame);
});

describe('JSX transformed in the browser, with no toolchain', () => {
  beforeEach(function raiseTheTimeout() {
    this.timeout(30000);
  });

  const inside = (selector) => app.shadowRoot.querySelector(selector);

  it('compiles and renders', () => {
    expect(inside('#picked').textContent).to.equal('none');
    expect([...app.shadowRoot.querySelectorAll('#rows li')].map((li) => li.dataset.id)).to.deep.equal([
      'a',
      'b',
      'c',
    ]);
  });

  it('a function component is a template factory, not an element', () => {
    /** `<Row/>` compiles to a call, so no `<row>` element exists anywhere. */
    expect(app.shadowRoot.querySelector('row'), 'a component became an element').to.equal(null);
    expect(inside('#rows li').localName).to.equal('li');
  });

  it('onClick compiles to a real event binding', async () => {
    inside('#rows li[data-id="b"]').click();
    await settle(frame);
    expect(inside('#picked').textContent, 'the handler never ran').to.equal('b');
  });

  it('hidden={…} compiles to a boolean attribute', async () => {
    expect(inside('#flag').hasAttribute('hidden'), 'a truthy boolean did not reach markup').to.equal(true);
    app.bump();
    await settle(frame);
    expect(inside('#flag').hasAttribute('hidden'), 'a false boolean must remove the attribute').to.equal(
      false
    );
  });

  it('key={…} keys the list, so a reorder moves nodes', async () => {
    const first = inside('#rows li[data-id="a"]');
    app.state.rows = ['c', 'b', 'a'];
    await settle(frame);
    expect([...app.shadowRoot.querySelectorAll('#rows li')].map((li) => li.dataset.id)).to.deep.equal([
      'c',
      'b',
      'a',
    ]);
    expect(inside('#rows li[data-id="a"]'), 'the keyed row was rebuilt rather than moved').to.equal(first);
  });
});
