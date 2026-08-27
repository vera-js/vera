/**
 * The two published extension points nothing had ever *used* — only named.
 *
 * Pass 93's lens was mechanical: for every export of every published entry point, how many test
 * files name it? Everything was named at least once, which is a weaker bar than it looks — pass 92's
 * defect survived because `setRenderScheduler` was named in a misuse test while its actual scheduling
 * behaviour was never exercised. Narrowing to "named by at most one file" surfaced these.
 *
 * Both are extension APIs, which is the worst place for a coverage gap: breakage is invisible to us
 * and fatal to whoever is extending the framework, and they are the shapes we are least likely to
 * use ourselves.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { JSDOM } from 'jsdom';
import { load, isProduction } from './dist.mjs';

const dom = new JSDOM('<!doctype html><body></body>', { pretendToBeVisual: true });
for (const key of ['document', 'HTMLElement', 'Node', 'Element', 'customElements', 'DocumentFragment',
                   'Text', 'Comment', 'CSSStyleSheet', 'requestAnimationFrame', 'cancelAnimationFrame', 'Event'])
  globalThis[key] = dom.window[key];

const core = await load('core');
const { renderInto } = await load('renderer');
const reactivity = await load('reactivity');
core.wire({ on: 'render', fn: renderInto, priority: 50 });

const frame = () => new Promise((resolve) => dom.window.requestAnimationFrame(() => setTimeout(resolve, 0)));

/**
 * **`GLOBAL` is a literal contract across a package boundary**, which is why it is asserted here
 * rather than trusted. `@verajs/core` declares `'_global'` itself instead of importing it, because a
 * production bundle inlines its dependencies and an import would subscribe to one string while
 * notifying another — working in development and silently failing in production, which is the exact
 * hazard `wire`-from-core exists to prevent. Nothing checked the two literals still agree.
 */
test('GLOBAL is the literal core declares for itself', () => {
  assert.equal(reactivity.GLOBAL, '_global');
});

test('a collection insert built from the published exports tracks size and entries', async () => {
  let wrapperCalls = 0;
  /** The documented use: "wrap it to add a type, or read it as the reference". */
  core.wire({
    on: 'collection',
    fn: (obj, prop, propValue, addCallback, runCallbacks) => {
      wrapperCalls++;
      return reactivity.collectionMethod(obj, prop, propValue, addCallback, runCallbacks);
    },
    priority: 50,
  });

  const tag = 'x-extension-collection';
  customElements.define(tag, class extends HTMLElement {
    connectedCallback() {
      core.init(this, { mode: 'open' });
      const state = core.createStore({ m: new Map([['a', 1]]) });
      this._state = state;
      core.render(() => core.html`<p>size:${state.m.size} a:${state.m.get('a')}</p>`);
    }
  });
  const element = dom.window.document.createElement(tag);
  dom.window.document.body.appendChild(element);
  await frame();

  assert.equal(element.shadowRoot.textContent, 'size:1 a:1');
  assert.ok(wrapperCalls > 0, 'the wrapping insert was never called, so this asserts nothing');

  /** A shape change notifies `GLOBAL`; if that literal ever diverges, `size` silently stops. */
  element._state.m.set('b', 2);
  await frame();
  assert.equal(element.shadowRoot.textContent, 'size:2 a:1', 'size did not track — check the GLOBAL contract');

  /** A per-entry change notifies the key, not the shape. */
  element._state.m.set('a', 9);
  await frame();
  assert.equal(element.shadowRoot.textContent, 'size:2 a:9', 'a per-entry change did not track');

  element._state.m.delete('b');
  await frame();
  assert.equal(element.shadowRoot.textContent, 'size:1 a:9', 'a delete did not update size');
});

/**
 * `veraJsx` is `@verajs/jsx`'s consumer-facing artifact — the whole of the documented build
 * integration is `plugins: [veraJsx()]` — and the only test naming it checked that the export
 * existed. The plugin was never run.
 */
test('the veraJsx bundler plugin transforms exactly the files it should', async () => {
  const { veraJsx } = await load('jsx');
  const plugin = veraJsx();
  assert.equal(plugin.name, 'vera-jsx');
  assert.equal(plugin.enforce, 'pre', 'it must run before other transforms, or JSX reaches them raw');

  const run = (id) => plugin.transform.call({}, 'const a = <p>{1}</p>;', id);
  for (const id of ['/app/x.jsx', '/app/x.tsx']) {
    const result = run(id);
    assert.ok(result && /html`<p>\$\{1\}<\/p>`/.test(result.code), `${id} was not transformed`);
  }
  for (const id of ['/app/x.js', '/app/x.ts']) {
    assert.equal(run(id), null, `${id} must be left alone`);
  }
  /** Vite appends a query to almost everything it serves, so stripping it is load-bearing. */
  assert.ok(run('/app/x.jsx?v=abc123')?.code.includes('html`'), 'a Vite query suffix must not stop the transform');
});

test('and honours the documented options', async () => {
  const { veraJsx } = await load('jsx');
  const injected = veraJsx().transform.call({}, 'const a = <p>{1}</p>;', '/app/x.jsx').code;
  assert.match(injected, /import \{ html \} from '@verajs\/core'/, 'the default is to inject the import');

  const bare = veraJsx({ inject: false }).transform.call({}, 'const a = <p>{1}</p>;', '/app/x.jsx').code;
  assert.doesNotMatch(bare, /^import/m, '{ inject: false } must not add an import');
  assert.match(bare, /html`<p>\$\{1\}<\/p>`/, 'but must still compile the JSX');
});

/**
 * The transform runs over whole modules, so anything that merely *looks* like JSX must survive. The
 * parser is hand-written, which is exactly why this is asserted rather than assumed.
 */
test('JSX-shaped text that is not JSX is left alone', async () => {
  const { transformJsx } = await load('jsx');
  const untouched = {
    'a double-quoted string': 'const s = "a <p>not jsx</p> b";',
    'a single-quoted string': "const s = 'a <p>not jsx</p> b';",
    'a template literal': 'const s = `a <p>not jsx</p> b`;',
    'a line comment': '// <p>not jsx</p>\nconst a = 1;',
    'a block comment': '/* <p>not jsx</p> */ const a = 1;',
    'a less-than comparison': 'const a = x < y && y > z;',
  };
  for (const [label, source] of Object.entries(untouched)) {
    const out = String(transformJsx(source, '/app/x.jsx', { inject: false }));
    assert.equal(out.trim(), source.trim(), `${label} was rewritten`);
  }
  /** And real JSX beside a string still compiles — the discrimination has to work both ways. */
  const mixed = String(transformJsx('const s = "<b>x</b>"; const a = <p>{1}</p>;', '/app/x.jsx', { inject: false }));
  assert.match(mixed, /const s = "<b>x<\/b>";/, 'the string was rewritten');
  assert.match(mixed, /html`<p>\$\{1\}<\/p>`/, 'the real JSX was not compiled');
});

void isProduction;
