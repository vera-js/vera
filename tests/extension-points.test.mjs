/**
 * The two published extension points nothing had ever *used* — only named.
 *
 * Pass 93's lens was mechanical: for every export of every published entry point, how many test
 * files name it? Everything was named at least once, which is a weaker bar than it looks — pass 92's
 * defect survived because `setRenderScheduler` was named in a misuse test while its actual scheduling
 * behavior was never exercised. Narrowing to "named by at most one file" surfaced these.
 *
 * Both are extension APIs, which is the worst place for a coverage gap: breakage is invisible to us
 * and fatal to whoever is extending the framework, and they are the shapes we are least likely to
 * use ourselves.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { JSDOM } from 'jsdom';
import { hydrating } from './hydration.mjs';
import { load, isProduction } from './dist.mjs';

const dom = new JSDOM('<!doctype html><body></body>', { pretendToBeVisual: true });
for (const key of ['document', 'HTMLElement', 'Node', 'Element', 'customElements', 'DocumentFragment',
                   'Text', 'Comment', 'CSSStyleSheet', 'requestAnimationFrame', 'cancelAnimationFrame', 'Event'])
  globalThis[key] = dom.window[key];

const core = await load('core');
const { renderInto, renderer } = await load('renderer');
const reactivity = await load('store');
core.wire({ on: 'render', fn: renderInto, priority: 50 });

const frame = () => new Promise((resolve) => dom.window.requestAnimationFrame(() => setTimeout(resolve, 0)));

/**
 * **A store module builds on core's reactivity through the kit, never through a literal of its own.**
 * The shape channel's name used to be declared twice — once in core, once in the collections package —
 * because an import across a production bundle subscribes to one copy and notifies another; nothing
 * checked the two literals agreed. Handing it over in the `'store'` kit makes agreement structural,
 * and this holds it: a module that tracks `kit.shape` on a plain object hears core's own notification
 * when a key is added.
 */
test("a 'store' module tracking kit.shape hears core add a key", () => {
  const met = new Map();
  core.wire({
    on: 'store',
    fn: (type, handler, kit) => {
      met.set(type, kit);
      return handler;
    },
    priority: 90,
  });
  const raw = { a: 1 };
  const state = core.createStore(raw);
  /** A store module decides per type, and `wire` consults it for every type already met. */
  const kit = met.get('object');
  assert.ok(kit, 'CONTROL: the store insert was consulted for plain objects');
  let heard = 0;
  const hook = core.createHook({ element: {}, priority: 10, callback: () => { heard++; kit.track(raw, kit.shape); } });
  hook(undefined, true);
  state.b = 2;
  assert.equal(heard, 2, 'adding a key woke the module subscribed to the channel the kit names');
});

test('a store module built from the published collections descriptor tracks size and entries', async () => {
  let consulted = 0;
  /** The documented use: "wrap it to add a type, or read it as the reference". */
  core.wire({
    on: 'store',
    fn: (type, handler, kit) => {
      consulted++;
      return reactivity.collections.fn(type, handler, kit);
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
  assert.ok(consulted > 0, 'the wrapping insert was never consulted, so this asserts nothing');

  /** A shape change notifies the kit's shape channel; if that ever diverged, `size` would silently stop. */
  element._state.m.set('b', 2);
  await frame();
  assert.equal(element.shadowRoot.textContent, 'size:2 a:1', 'size did not track the shape channel');

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
    /** The child expression is wrapped — JSX drops a boolean child, so every child goes through
     *  the module-local filter. Matching the wrapper keeps this pinned to real output. */
    assert.ok(result && /html`<p>\$\{\$veraChild\(1\)\}<\/p>`/.test(result.code), `${id} was not transformed`);
  }
  for (const id of ['/app/x.js', '/app/x.ts']) {
    assert.equal(run(id), null, `${id} must be left alone`);
  }
  /** Vite appends a query to almost everything it serves, so stripping it is load-bearing. */
  assert.ok(run('/app/x.jsx?v=abc123')?.code.includes('html`'), 'a Vite query suffix must not stop the transform');
});

test('and honors the documented options', async () => {
  const { veraJsx } = await load('jsx');
  const injected = veraJsx().transform.call({}, 'const a = <p>{1}</p>;', '/app/x.jsx').code;
  assert.match(injected, /import \{ html \} from '@verajs\/core'/, 'the default is to inject the import');

  const bare = veraJsx({ inject: false }).transform.call({}, 'const a = <p>{1}</p>;', '/app/x.jsx').code;
  assert.doesNotMatch(bare, /^import/m, '{ inject: false } must not add an import');
  assert.match(bare, /html`<p>\$\{\$veraChild\(1\)\}<\/p>`/, 'but must still compile the JSX');
  /** `inject` governs IMPORTS; the child filter is a module-local const, so the output stays valid
   *  even when the caller supplies its own `html` — without it the module throws at first render. */
  assert.match(bare, /const \$veraChild = /, 'and must still DEFINE the helper it calls');
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
  assert.match(mixed, /html`<p>\$\{\$veraChild\(1\)\}<\/p>`/, 'the real JSX was not compiled');
});


/**
 * `/profiler` is a drop-in replacement for the whole renderer, bundling its own copy with its own
 * instrumentation hook — so an app rendering through `@verajs/renderer` (here: hydrating through it)
 * while profiling this entry observes an instance nothing renders into. A hydrating app profiled
 * through the profiler's OWN renderer works (`tests/profiler-hydration`).
 *
 * That is a design consequence rather than a bug. The bug was its **silence**: a report of all zeros
 * is exactly what a healthy idle app produces, so the one result that cannot be read was the one
 * being returned. Pass 94.
 */
test('profiling the WRONG renderer copy explains itself instead of reporting a silent zero', { skip: isProduction && 'the profiler is not built for production' }, async () => {
  const profiler = await load('renderer/profiler');
  const hydrateInto = await hydrating();
  const host = dom.window.document.createElement('div');
  host.innerHTML = '<p>1</p>';

  profiler.startProfiling();
  hydrateInto(core.html`<p>${1}</p>`, host);
  hydrateInto(core.html`<p>${2}</p>`, host);
  const report = profiler.stopProfiling();

  assert.equal(host.textContent, '2', 'the app must still render — only the profiler is blind');
  assert.equal(report.frames, 0, 'if this ever observes frames, the two bundles have started sharing a hook');
  const text = profiler.formatReport(report);
  assert.match(text, /No renders observed/);
  assert.match(text, /different copy of the renderer/, 'the message must name the actual cause');
  assert.match(text, /wire\(\[renderer, hydration\]\)/, 'and how a hydrating app is profiled');
});

test('and a real profiling session still reports normally', { skip: isProduction && 'the profiler is not built for production' }, async () => {
  const profiler = await load('renderer/profiler');
  const host = dom.window.document.createElement('div');
  profiler.startProfiling();
  profiler.renderInto(core.html`<p>${1}</p>`, host);
  profiler.renderInto(core.html`<p>${2}</p>`, host);
  const text = profiler.formatReport(profiler.stopProfiling());
  assert.match(text, /2 frame\(s\)/, 'the zero-report branch must not swallow a real one');
});

/**
 * The 'value' table row's exclusion, pinned: "strings, numbers, null and undefined never reach
 * it — those take a fast path — so this cannot be used to intercept text." insert-failure-contract
 * works AROUND this fact (its comment says so) and nothing held it, which is the shape that lets
 * a fast-path removal ship silently: every existing 'value' test uses objects, so nothing goes
 * red when primitives suddenly start reaching user code. Booleans fast-path too — measured, and
 * asserted here as the wider truth the doc's narrower claim sits inside.
 */
test("the 'value' chain never sees primitives — the fast path is the security line", () => {
  /** The renderer as a MODULE: its `connect` is what hands it the registry the 'value' chain lives in. */
  core.wire([renderer]);
  const seen = [];
  core.wire({ on: 'value', fn: (part, value) => { seen.push(typeof value); return true; }, priority: 40 });
  const host = dom.window.document.createElement('div');
  dom.window.document.body.appendChild(host);
  for (const value of ['text', 42, 0, null, undefined, false, true])
    renderInto(core.html`<p>${value}</p>`, host);
  assert.deepEqual(seen, [], 'a primitive reached the value chain');
  renderInto(core.html`<p>${{ custom: 1 }}</p>`, host);
  assert.equal(seen.length, 1, 'CONTROL: an object still reaches it');
  host.remove();
});
